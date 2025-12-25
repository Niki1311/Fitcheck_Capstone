import motor.motor_asyncio
import certifi
import asyncio

async def main():
    client = motor.motor_asyncio.AsyncIOMotorClient(
        "mongodb+srv://nikita:Nik950257@cluster0.eo3opxq.mongodb.net/fitcheck_db?retryWrites=true&w=majority",
        tls=True,
        tlsCAFile=certifi.where()
    )
    try:
        dbs = await client.list_database_names()
        print(dbs)
    except Exception as e:
        print("MongoDB connection error:", e)

asyncio.run(main())
