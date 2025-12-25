import os
import io
from dotenv import load_dotenv
from pymongo import MongoClient
from PIL import Image
import cloudinary
import cloudinary.uploader
from rembg import remove

# ---------------- LOAD ENV ----------------
load_dotenv()  # Loads from .env in current folder

MONGO_URI = os.getenv("MONGO_URI")
CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
API_KEY = os.getenv("CLOUDINARY_API_KEY")
API_SECRET = os.getenv("CLOUDINARY_API_SECRET")

# ---------------- TEST MONGO CONNECTION ----------------
try:
    client = MongoClient(MONGO_URI)
    db = client["fitcheck"]
    users_collection = db["users"]
    print("✅ MongoDB connected:", db.list_collection_names())
except Exception as e:
    print("❌ MongoDB connection failed:", e)

# ---------------- CONFIGURE CLOUDINARY ----------------
cloudinary.config(
    cloud_name=CLOUD_NAME,
    api_key=API_KEY,
    api_secret=API_SECRET
)

# ---------------- TEST UPLOAD ----------------
try:
    test_file = "icon.png"  # Make sure this file exists
    if not os.path.exists(test_file):
        raise FileNotFoundError(f"{test_file} not found in current folder.")

    # Remove background first
    with open(test_file, "rb") as f:
        input_image = Image.open(f).convert("RGBA")
    output_image = remove(input_image)

    # Save to buffer
    buf = io.BytesIO()
    output_image.save(buf, format="PNG")
    buf.seek(0)

    # Upload to Cloudinary
    result = cloudinary.uploader.upload(buf, folder="fitcheck/test", resource_type="image", format="png")
    print("✅ Cloudinary upload successful! URL:", result["secure_url"])

except Exception as e:
    print("❌ Upload failed:", e)
