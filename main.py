# main.py – FitCheck OpenAI Version (GPT-5.1 mini)
"""
Backend for FitCheck using OpenAI vision + reasoning

Features:
- Auth (signup/login with JWT)
- Add item: upload image -> Cloudinary -> OpenAI analyzes attributes (category, color, material, etc.) -> store in Mongo
- Get wardrobe items
- Delete item
- Outfit recommendations:
    - /outfit/from-prompt : uses only wardrobe + user prompt (occasion/requirements and optional weather)
                            * Also supports base_image_url from existing wardrobe
    - /outfit/from-image  : user uploads a NEW base image + prompt -> adds to wardrobe -> completes outfit
"""

import os, io, random, logging, requests
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Depends, Header, HTTPException, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from jose import jwt, JWTError
from passlib.context import CryptContext
from pymongo import MongoClient
from PIL import Image
from dotenv import load_dotenv

import cloudinary, cloudinary.uploader
from openai import OpenAI
from math import isfinite

# ------------------ ENV + CONFIG ------------------
load_dotenv()

SECRET_KEY = os.getenv("JWT_SECRET", "supersecret")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7
MONGO_URI = os.getenv("MONGO_URI")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")

# pick models here
OPENAI_ATTRIBUTE_MODEL = "gpt-5-mini"   # for item attribute extraction
OPENAI_RECO_MODEL      = "gpt-5-mini"   # for outfit recommendations

if not MONGO_URI:
    raise RuntimeError("Missing MONGO_URI in .env")
if not OPENAI_API_KEY:
    raise RuntimeError("Missing OPENAI_API_KEY in .env")

client_mongo = MongoClient(MONGO_URI)
db = client_mongo["fitcheck"]
users_col = db["users"]
items_col = db["items"]

client_oa = OpenAI(api_key=OPENAI_API_KEY)

# ------------------ CLOUDINARY ------------------
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

# ------------------ LOGGING ------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fitcheck")

# ------------------ AUTH HELPERS ------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(pw: str) -> str:
    return pwd_context.hash(pw)

def verify_password(pw: str, hashed: str) -> bool:
    return pwd_context.verify(pw, hashed)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    data.update({"exp": expire})
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

def get_current_user(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header")
    try:
        token = authorization.split(" ", 1)[1]
        payload = decode_token(token)
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ------------------ WEATHER HELPER ------------------

def get_weather_for_coords(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Fetch current weather for given coordinates using OpenWeatherMap
    and return a small, model-friendly summary.
    """
    if not OPENWEATHER_API_KEY:
        logger.warning("No OPENWEATHER_API_KEY set; skipping weather.")
        return None

    try:
        url = (
            "https://api.openweathermap.org/data/2.5/weather"
            f"?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric"
        )
        r = requests.get(url, timeout=5)
        r.raise_for_status()
        data = r.json()

        temp_c = data["main"]["temp"]
        feels_c = data["main"]["feels_like"]
        condition = data["weather"][0]["description"]
        humidity = data["main"].get("humidity")
        wind_speed = data.get("wind", {}).get("speed")

        # simple flags the model can easily use
        is_cold = feels_c < 10   # tweak thresholds as you like
        is_hot = feels_c > 28
        is_rainy = any("rain" in w["main"].lower() for w in data.get("weather", []))

        return {
            "temp_c": temp_c,
            "feels_like_c": feels_c,
            "condition": condition,
            "humidity": humidity,
            "wind_speed_mps": wind_speed,
            "is_cold": is_cold,
            "is_hot": is_hot,
            "is_rainy": is_rainy,
        }
    except Exception as e:
        logger.warning(f"Weather fetch failed: {e}")
        return None

# ------------------ OPENAI JSON HELPERS ------------------

ATTRIBUTE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "category": {"type": "string"},
        "color": {"type": "string"},
        "material": {"type": "string"},
        "texture": {"type": "string"},
        "pattern": {"type": "string"},
        "formality": {"type": "string"},
        "season_tags": {
            "type": "array",
            "items": {"type": "string"},
            "additionalProperties": False,
        },
        "style_tags": {
            "type": "array",
            "items": {"type": "string"},
            "additionalProperties": False,
        },
        "notes": {"type": "string"},
    },
    # gpt-5-mini wants *every* property listed as required
    "required": [
        "name",
        "category",
        "color",
        "material",
        "texture",
        "pattern",
        "formality",
        "season_tags",
        "style_tags",
        "notes",
    ],
    "additionalProperties": False,
}


def chat_json_with_fallback(messages, schema_name, schema):
    """
    Try gpt-5-mini first. If the model doesn't exist / you lack access,
    fall back to gpt-4o-mini automatically.

    IMPORTANT: gpt-5-mini does NOT allow custom temperature, so we omit it there.
    """
    import json
    model_primary = "gpt-5-mini"
    model_fallback = "gpt-4o-mini"

    for model in [model_primary, model_fallback]:
        try:
            kwargs = {
                "model": model,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema_name,
                        "schema": schema,
                        "strict": True,
                    },
                },
                "messages": messages,
            }
            # Only non-gpt-5 models get a custom temperature
            if not model.startswith("gpt-5"):
                kwargs["temperature"] = 0.2

            resp = client_oa.chat.completions.create(**kwargs)
            return json.loads(resp.choices[0].message.content)

        except Exception as e:
            text = str(e)
            if "model" in text and ("does not exist" in text or "do not have access" in text):
                logger.warning(f"Model {model} not available, trying fallback...")
                continue
            logger.error(f"OpenAI call failed on model {model}: {e}")
            raise

    raise RuntimeError("All OpenAI models failed (gpt-5-mini and gpt-4o-mini)")


def analyze_item_attributes(image_url: str, suggested_name: Optional[str]) -> Dict[str, Any]:
    """
    Ask OpenAI (vision) to describe the garment in structured attributes.
    """
    system = (
        "You are a fashion stylist. Extract concise attributes from a single garment image. "
        "Be factual and conservative; if unsure, use 'unknown'."
    )

    user_content = [
        {"type": "text", "text": "Extract attributes for this single garment. Keep answers short."},
        {"type": "image_url", "image_url": {"url": image_url}},
    ]

    obj = chat_json_with_fallback(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        schema_name="GarmentAttributes",
        schema=ATTRIBUTE_JSON_SCHEMA,
    )

    if suggested_name and not obj.get("name"):
        obj["name"] = suggested_name

    return obj


RECO_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "selected_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "image_url": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["image_url", "reason"],
                "additionalProperties": False,
            },
        },
        "overall_reason": {"type": "string"},
        "weather_summary": {"type": "string"},
        "weather_warning": {"type": "string"},
    },
    # gpt-5-mini: required must include every key in properties
    "required": [
        "selected_items",
        "overall_reason",
        "weather_summary",
        "weather_warning",
    ],
    "additionalProperties": False,
}


def recommend_outfit(
    wardrobe_attrs: List[Dict[str, Any]],
    prompt: str,
    weather: Optional[Dict[str, Any]],
    base_image_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Ask OpenAI to pick a cohesive outfit from wardrobe given prompt and optional base image + weather.
    """
    system = (
        "You are a fashion stylist. Select a cohesive outfit from the user's wardrobe.\n"
        "- Only pick from items in the wardrobe list.\n"
        "- Build realistic outfits: top+bottom+shoes (+/- outerwear) or dress+shoes (+/- outerwear).\n"
        "- Consider color harmony, material/texture, formality, season_tags, and style_tags.\n"
        "- Respect the user's prompt (occasion, vibe, constraints).\n"
        "- Use the weather info if provided:\n"
        "  * If weather.is_cold is true, prefer warmer materials.\n"
        "  * IMPORTANT: You MAY select light items (e.g. dresses, thin tops) in cold weather IF AND ONLY IF you also select a heavy outer layer (coat, jacket) to cover them.\n"
        "  * If weather.is_hot is true, prefer lighter fabrics and avoid heavy outerwear.\n"
        "  * If weather.is_rainy is true, avoid delicate shoes and very long dragging hems.\n"
        "- For each selected_items[i].reason, write ONE short, vivid sentence (max ~20 words) describing why that item works.\n"
        "- overall_reason must be at most 100 words. Write it as a short paragraph of 3–6 concise points separated by periods or semicolons.\n"
        "- Always include ALL of these JSON fields, even if some are empty strings:\n"
        "  * selected_items: array of items with image_url and reason.\n"
        "  * overall_reason: short stylist logic (<= 100 words).\n"
        "  * weather_summary: brief sentence about today's weather, or \"\" if no weather data.\n"
        "  * weather_warning: brief warning if outfit doesn’t match weather, or \"\" if there is no issue.\n"
        "- Prefer 2–4 items per outfit (e.g. top, bottom, shoes, optional outerwear).\n"
        "- CRITICAL: If a base_image_url is provided, you MUST include it in 'selected_items' as the centerpiece."
    )

    wardrobe_compact = []
    for it in wardrobe_attrs:
        wardrobe_compact.append({
            "image_url": it.get("image_url", ""),
            "name": it.get("name", ""),
            "category": it.get("category", ""),
            "color": it.get("color", ""),
            "material": it.get("material", ""),
            "texture": it.get("texture", ""),
            "pattern": it.get("pattern", ""),
            "formality": it.get("formality", ""),
            "season_tags": it.get("season_tags", []),
            "style_tags": it.get("style_tags", []),
            "gender": it.get("gender", "unisex"),
        })

    user_parts: List[Dict[str, Any]] = []

    if base_image_url:
        user_parts.append({"type": "text", "text": "Complete an outfit around this base item:"})
        user_parts.append({"type": "image_url", "image_url": {"url": base_image_url}})
    else:
        user_parts.append({"type": "text", "text": "No base image; build a full outfit only from the wardrobe."})

    user_parts.append({"type": "text", "text": f"User prompt (occasion / requirements): {prompt or 'none'}"})

    if weather:
        user_parts.append({"type": "text", "text": f"Weather context: {weather}"})

    user_parts.append({"type": "text", "text": "Wardrobe items (attributes only):"})
    user_parts.append({"type": "text", "text": str(wardrobe_compact)})

    obj = chat_json_with_fallback(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_parts},
        ],
        schema_name="OutfitPick",
        schema=RECO_JSON_SCHEMA,
    )
    return obj

# ------------------ WEATHER ENFORCEMENT LAYER ------------------

def enforce_weather_rules(
    rec: Dict[str, Any],
    wardrobe: List[Dict[str, Any]],
    weather: Optional[Dict[str, Any]],
    prompt: str,
) -> Dict[str, Any]:
    """
    Server-side safety layer.
    Includes deduplication and smart layering logic.
    """
    # --- FIX: DEDUPLICATE ITEMS FIRST ---
    raw_items = rec.get("selected_items", [])
    seen_urls = set()
    unique_items = []
    for item in raw_items:
        url = item.get("image_url")
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique_items.append(item)
    rec["selected_items"] = unique_items
    # ------------------------------------

    if not weather:
        return rec

    is_hot = bool(weather.get("is_hot"))
    is_cold = bool(weather.get("is_cold"))

    if not (is_hot or is_cold):
        return rec

    rec["weather_warning"] = ""
    prompt_lower = (prompt or "").lower()

    # Keywords
    wants_warm = any(
        kw in prompt_lower
        for kw in ["keep me warm", "winter", "coat", "jacket", "sweater", "fur", "warm"]
    )
    wants_cool = any(
        kw in prompt_lower
        for kw in ["summer", "beach", "light", "hot", "swim", "bikini", "shorts"]
    )

    by_url = {it["image_url"]: it for it in wardrobe}

    heavy_categories = {
        "coat", "jacket", "sweater", "hoodie", "parka", "puffer", "overcoat", "fur coat"
    }
    heavy_material_keywords = ["wool", "fur", "shearling", "down", "thick"]

    light_categories = {
        "tank top", "camisole", "cami", "crop top", "shorts", 
        "mini skirt", "mini dress", "slip dress", "dress",
        "sandals", "flip flops", "slides"
    }
    light_material_keywords = ["linen", "chiffon", "mesh", "lace", "thin", "silk", "satin"]

    selected = rec.get("selected_items", [])
    
    # --- PRE-SCAN for HEAVY OUTER LAYER ---
    has_heavy_outer = False
    for sel in selected:
        src = by_url.get(sel.get("image_url") or "", {})
        cat = (src.get("category") or "").lower()
        mat = (src.get("material") or "").lower()
        if cat in heavy_categories or any(kw in mat for kw in heavy_material_keywords):
            has_heavy_outer = True
            break
    # --------------------------------------

    new_items: List[Dict[str, Any]] = []
    kept_problematic_hot: List[str] = []
    kept_problematic_cold: List[str] = []

    for sel in selected:
        src = by_url.get(sel.get("image_url") or "", {})
        cat = (src.get("category") or "").lower()
        mat = (src.get("material") or "").lower()

        is_heavy = cat in heavy_categories or any(kw in mat for kw in heavy_material_keywords)
        is_light = cat in light_categories or any(kw in mat for kw in light_material_keywords)

        # HOT WEATHER LOGIC
        if is_hot and is_heavy:
            if wants_warm:
                kept_problematic_hot.append(src.get("name") or "item")
                new_items.append(sel)
            else:
                continue
            continue

        # COLD WEATHER LOGIC
        if is_cold and is_light:
            # Allow light items if user wants summer vibes OR has a heavy coat (layering)
            if wants_cool or has_heavy_outer:
                # Only warn if they kept a light item purely for style (wants_cool) 
                # and lack a coat to cover it up.
                if wants_cool and not has_heavy_outer:
                    kept_problematic_cold.append(src.get("name") or "item")
                new_items.append(sel)
            else:
                continue
            continue

        new_items.append(sel)

    rec["selected_items"] = new_items

    # Generate Warnings
    warnings: List[str] = []
    if kept_problematic_hot and wants_warm and is_hot:
        names = ", ".join(kept_problematic_hot)
        warnings.append(f"It's hot, but you asked for winter gear ({names}).")

    if kept_problematic_cold and wants_cool and is_cold:
        names = ", ".join(kept_problematic_cold)
        warnings.append(f"It's cold, but you asked for summer gear ({names}).")

    rec["weather_warning"] = " ".join(warnings).strip()

    return rec

# ------------------ FASTAPI APP ------------------
app = FastAPI(title="FitCheck – OpenAI Outfit Engine (GPT-5.1 mini)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev mode
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------ AUTH ROUTES ------------------
@app.post("/signup")
async def signup(username: str = Form(...), password: str = Form(...)):
    if users_col.find_one({"username": username}):
        raise HTTPException(status_code=400, detail="Username exists")
    users_col.insert_one({"username": username, "password": get_password_hash(password)})
    token = create_access_token({"sub": username})
    return {"access_token": token}

@app.post("/token")
async def login(username: str = Form(...), password: str = Form(...)):
    user = users_col.find_one({"username": username})
    if not user or not verify_password(password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"sub": username})
    return {"access_token": token}

# ------------------ IMAGE / ITEM ROUTES ------------------

@app.post("/add-item")
async def add_item(
    file: UploadFile = File(...),
    name: str = Form(""),
    gender: str = Form(None),
    current_user: str = Depends(get_current_user),
):
    """
    User takes a photo of an item -> remove background -> upload to Cloudinary ->
    OpenAI analyzes attributes -> store in Mongo.
    """
    from rembg import remove as rembg_remove

    try:
        img_bytes = await file.read()
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

        # remove background
        img_nobg = rembg_remove(img)
        if not isinstance(img_nobg, Image.Image):
            img_nobg = Image.open(io.BytesIO(img_nobg)).convert("RGB")

        # upload to Cloudinary
        buf = io.BytesIO()
        img_nobg.save(buf, format="PNG")
        buf.seek(0)

        upload = cloudinary.uploader.upload(buf, folder=f"fitcheck/{current_user}")
        file_url = upload["secure_url"]

        # analyze attributes with OpenAI
        attrs = analyze_item_attributes(file_url, suggested_name=name.strip() or "Unnamed")

        doc = {
            "username": current_user,
            "name": attrs.get("name") or (name.strip() or "Unnamed"),
            "image_url": file_url,
            "gender": gender or "unisex",
            "category": attrs.get("category", "other").lower(),
            "color": attrs.get("color", "unknown").lower(),
            "material": attrs.get("material", "unknown").lower(),
            "texture": attrs.get("texture", "unknown").lower(),
            "pattern": attrs.get("pattern", "unknown").lower(),
            "formality": attrs.get("formality", "unknown").lower(),
            "season_tags": attrs.get("season_tags", []),
            "style_tags": attrs.get("style_tags", []),
            "notes": attrs.get("notes", ""),
            "created_at": datetime.utcnow(),
        }

        items_col.insert_one(doc)

        # response without internal fields
        resp_item = {k: v for k, v in doc.items() if k not in ["_id"]}
        return {"msg": "saved", "item": resp_item}

    except Exception as e:
        logger.error("add-item error: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.delete("/delete-item")
async def delete_item(
    image_url: str = Form(...),
    current_user: str = Depends(get_current_user),
):
    result = items_col.delete_one({"username": current_user, "image_url": image_url})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"msg": "Deleted successfully"}

@app.get("/items")
def get_items(current_user: str = Depends(get_current_user)):
    items = list(items_col.find({"username": current_user}, {"_id": 0}))
    
    cleaned = []
    for it in items:
        # Drop any old embedding field completely
        it.pop("embedding", None)

        # Extra safety: ensure no NaN/inf floats sneak through
        for k, v in list(it.items()):
            if isinstance(v, float) and not isfinite(v):
                it[k] = None

        cleaned.append(it)

    return cleaned

# ------------------ OUTFIT RECOMMENDATION ROUTES ------------------

@app.post("/outfit/from-prompt")
async def outfit_from_prompt(
    payload: dict = Body(...),  # { "prompt": "...", "lat": ..., "lon": ... }
    current_user: str = Depends(get_current_user),
):
    prompt = payload.get("prompt", "")
    lat = payload.get("lat")
    lon = payload.get("lon")
    # --- Check if we are using an existing wardrobe item ---
    base_url = payload.get("base_image_url") 

    weather = get_weather_for_coords(lat, lon) if (lat is not None and lon is not None) else None

    wardrobe = list(items_col.find({"username": current_user}, {"_id": 0}))
    if not wardrobe:
        return {
            "selected_items": [],
            "overall_reason": "No wardrobe items found.",
            "weather_summary": "",
            "weather_warning": "",
        }

    # Pass the existing URL directly to the stylist
    rec = recommend_outfit(wardrobe, prompt, weather, base_image_url=base_url)

    # --- SAFETY INJECTION: Ensure base item is in the list ---
    if base_url:
        # Check if the AI included it
        included_urls = [it.get("image_url") for it in rec.get("selected_items", [])]
        if base_url not in included_urls:
            # AI forgot it; force inject it at the top
            rec["selected_items"].insert(0, {
                "image_url": base_url,
                "reason": "The centerpiece item you selected."
            })
    # ---------------------------------------------------------

    rec = enforce_weather_rules(rec, wardrobe, weather, prompt)

    # Enrich selected_items with wardrobe metadata
    by_url = {it["image_url"]: it for it in wardrobe}
    for sel in rec.get("selected_items", []):
        src = by_url.get(sel["image_url"])
        if src:
            sel["name"] = src.get("name", "")
            sel["category"] = src.get("category", "")
            sel["color"] = src.get("color", "")
            sel["material"] = src.get("material", "")
            sel["texture"] = src.get("texture", "")
            sel["pattern"] = src.get("pattern", "")

    return rec

@app.post("/outfit/from-image")
async def outfit_from_image(
    prompt: str = Form(""),
    file: UploadFile = File(...),
    lat: Optional[float] = Form(None),
    lon: Optional[float] = Form(None),
    current_user: str = Depends(get_current_user),
):
    """
    User uploads a *base item image* + prompt, and we:
    - remove background
    - upload the image
    - analyze attributes with OpenAI
    - save it into the wardrobe as a new item
    - fetch weather (if coords given)
    - then complete the outfit from the full wardrobe (including this new base item)
    - enforce strict weather rules
    """
    from rembg import remove as rembg_remove

    try:
        # 1) load and remove background
        img_bytes = await file.read()
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img_nobg = rembg_remove(img)
        if not isinstance(img_nobg, Image.Image):
            img_nobg = Image.open(io.BytesIO(img_nobg)).convert("RGB")

        # 2) upload base image (without background) to Cloudinary
        buf = io.BytesIO()
        img_nobg.save(buf, format="PNG")
        buf.seek(0)
        upload = cloudinary.uploader.upload(
            buf,
            folder=f"fitcheck/{current_user}/base"
        )
        base_url = upload["secure_url"]

        # 3) analyze attributes and save as a new wardrobe item
        attrs = analyze_item_attributes(base_url, suggested_name="Base item")
        base_doc = {
            "username": current_user,
            "name": attrs.get("name") or "Base item",
            "image_url": base_url,
            "gender": "unisex",
            "category": attrs.get("category", "other").lower(),
            "color": attrs.get("color", "unknown").lower(),
            "material": attrs.get("material", "unknown").lower(),
            "texture": attrs.get("texture", "unknown").lower(),
            "pattern": attrs.get("pattern", "unknown").lower(),
            "formality": attrs.get("formality", "unknown").lower(),
            "season_tags": attrs.get("season_tags", []),
            "style_tags": attrs.get("style_tags", []),
            "notes": attrs.get("notes", ""),
            "created_at": datetime.utcnow(),
        }
        items_col.insert_one(base_doc)

        # 4) wardrobe now includes the new base item
        wardrobe = list(items_col.find({"username": current_user}, {"_id": 0}))
        if not wardrobe:
            return {
                "selected_items": [],
                "overall_reason": "No wardrobe items found.",
                "weather_summary": "",
                "weather_warning": "",
            }

        # 5) get weather (if mobile sent coords)
        weather = get_weather_for_coords(lat, lon) if (lat is not None and lon is not None) else None

        # 6) ask the stylist model
        rec = recommend_outfit(wardrobe, prompt, weather, base_image_url=base_url)

        # --- SAFETY INJECTION: Ensure base item is in the list ---
        if base_url:
            included_urls = [it.get("image_url") for it in rec.get("selected_items", [])]
            if base_url not in included_urls:
                rec["selected_items"].insert(0, {
                    "image_url": base_url,
                    "reason": "The base item you uploaded."
                })
        # ---------------------------------------------------------

        # 7) enforce strict weather rules (e.g. light vs heavy according to request & weather)
        rec = enforce_weather_rules(rec, wardrobe, weather, prompt)

        # 8) enrich selected_items with wardrobe metadata
        by_url = {it["image_url"]: it for it in wardrobe}
        for sel in rec.get("selected_items", []):
            src = by_url.get(sel["image_url"])
            if src:
                sel["name"] = src.get("name", "")
                sel["category"] = src.get("category", "")
                sel["color"] = src.get("color", "")
                sel["material"] = src.get("material", "")
                sel["texture"] = src.get("texture", "")
                sel["pattern"] = src.get("pattern", "")

        return rec
    except Exception as e:
        logger.error("outfit_from_image error: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})

# ------------------ LOCAL RUN ------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)