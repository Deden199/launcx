from pymongo import MongoClient

uri = "mongodb+srv://dzlauncx:bogor199@staging.5nrh0ma.mongodb.net/laucxdb?retryWrites=true&w=majority&appName=launcx-staging"

client = MongoClient(uri)

db = client["laucxdb"]
col = db["Order"]

result = col.update_many(
    {},
    [
        {
            "$set": {
                "paymentReceivedTime": {
                    "$cond": {
                        "if": { "$eq": [{ "$type": "$paymentReceivedTime" }, "string"] },
                        "then": { "$toDate": "$paymentReceivedTime" },
                        "else": "$paymentReceivedTime",
                    }
                },
                "settlementTime": {
                    "$cond": {
                        "if": { "$eq": [{ "$type": "$settlementTime" }, "string"] },
                        "then": { "$toDate": "$settlementTime" },
                        "else": "$settlementTime",
                    }
                },
                "trxExpirationTime": {
                    "$cond": {
                        "if": { "$eq": [{ "$type": "$trxExpirationTime" }, "string"] },
                        "then": { "$toDate": "$trxExpirationTime" },
                        "else": "$trxExpirationTime",
                    }
                },
            }
        }
    ],
)

print("Matched:", result.matched_count)
print("Modified:", result.modified_count)
