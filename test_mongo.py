import motor.motor_asyncio
import certifi
import asyncio
import os
from dotenv import load_dotenv

# Load variables from .env
load_dotenv()

async def main():
    # Get the URI from the .env file
    uri = os.getenv("MONGO_URI")
    
    if not uri:
        print("Error: MONGO_URI not found in .env file")
        return

    client = motor.motor_asyncio.AsyncIOMotorClient(
        uri,
        tls=True,
        tlsCAFile=certifi.where()
    )
    
    try:
        dbs = await client.list_database_names()
        print("Successfully connected! Databases:", dbs)
    except Exception as e:
        print("MongoDB connection error:", e)

if __name__ == "__main__":
    asyncio.run(main())