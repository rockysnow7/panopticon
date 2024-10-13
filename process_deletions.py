from dotenv import load_dotenv

import os
import pymongo
import urllib.parse


load_dotenv()

mongo_username = os.getenv("MONGO_USERNAME")
mongo_password = os.getenv("MONGO_PASSWORD")

username = urllib.parse.quote_plus(mongo_username)
password = urllib.parse.quote_plus(mongo_password)

client = pymongo.MongoClient(f"mongodb+srv://{username}:{password}@cluster0.zmdlf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
client.admin.command("ping")

db = client["db"]


deletions = db["deletions"].find()
for deletion in deletions:
    secret_id = deletion["secretID"]
    print(f"Processing deletion {secret_id}.")

    users = db["users"].find({
        "shares": {
            "$elemMatch": {
                "secretID": secret_id,
            }
        }
    })
    for user in users:
        db["users"].update_one({"_id": user["_id"]}, {"$pull": {"shares": {"secretID": secret_id}}})
        print(f"Deleted shares for user {user['_id']}.")

    db["deletions"].delete_one({"_id": deletion["_id"]})
    print(f"Deleted deletion {deletion['_id']}.")

