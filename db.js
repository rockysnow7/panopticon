const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");
const sss = require("shamirs-secret-sharing");
const nthline = require("nthline");

const mongo_username = process.env.MONGO_USERNAME;
const mongo_password = process.env.MONGO_PASSWORD;
console.log(mongo_username, mongo_password);

const uri = `mongodb+srv://${mongo_username}:${mongo_password}@cluster0.zmdlf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri);
const db = client.db("db");

const NUM_USERS_TO_SHARE_WITH = 3;

/** Check if an email is already taken. */
const isEmailTaken = async email => {
    try {
        const collection = db.collection("users");
        const user = await collection.findOne({ email: email });

        return user !== null;
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Check if a user exists with the given email. */
const getUser = async email => {
    try {
        const collection = db.collection("users");
        const user = await collection.findOne({ email: email });

        return user;
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Check if a password is correct for a given user. */
const checkPassword = async (email, password) => {
    try {
        const collection = db.collection("users");
        const user = await collection.findOne({ email: email });

        return await bcrypt.compare(password, user.password);
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Insert a user into the database. A user should be of the following form:
 *  {
 *      name: string,
 *      email: string,
 *      password: string, (plaintext)
 *  }
 */
const insertUser = async user => {
    try {
        // seems bad to hash server-side but idk how to do it client-side </3
        user.password = await bcrypt.hash(user.password, 10);
        user.queue = []; // array of objects of form { secretID: string, shares: string[] }
        user.shares = []; // array of objects of form { secretID: string, share: string }
        user.progress = {}; // object of form { secretID: number }

        const collection = db.collection("users");
        const result = await collection.insertOne(user);
        console.log(`Inserted user with the id ${result.insertedId}.`);
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Update the user with the given email in the database. A user should be of the following form:
 *  {
 *      name: string,
 *      email: string,
 *  }
 */
const updateUser = async (email, user) => {
    try {
        const collection = db.collection("users");
        if (user.name.length !== 0) {
            await collection.updateOne({ email: email }, { $set: { name: user.name } });
        }
        if (user.email.length !== 0) {
            await collection.updateOne({ email: email }, { $set: { email: user.email } });
        }
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Convert a UUIDv4 to a string of words. */
const uuidToWords = async uuid => {
    const sections = uuid.replace(/-/g, "").match(/.{1,4}/g); // split into 8 16-bit sections
    const words = await Promise.all(sections.map(async (section) => {
        const index = parseInt(section, 16);
        const word = await nthline(index, "words.txt");

        return word;
    }));

    return words.join("-");
};

/** Split a secret into n shares. */
const splitSecret = async (secret, n) => {
    const secret_buffer = Buffer.from(secret);
    const shares = sss.split(secret_buffer, {
        shares: n,
        threshold: n,
    });
    const sharesWords = await Promise.all(shares.map(async (share) => {
        const shareHex = share.toString("hex");
        const words = await uuidToWords(shareHex);

        return words;
    }));

    return sharesWords;
};

/** Push a secret to the user's queue of shares to be shared. */
const pushSecretToQueue = async (email, secret) => {
    try {
        const secretID = await uuidToWords(crypto.randomUUID());
        const shares = await splitSecret(secret, NUM_USERS_TO_SHARE_WITH);
        const sharesWithID = {
            secretID: secretID,
            shares: shares,
        };
        const collection = db.collection("users");
        await collection.updateOne(
            { email: email },
            { $push: { queue: sharesWithID } },
        );
        await collection.updateOne(
            { email: email },
            { $set: { [`progress.${secretID}`]: 0 } },
        );
        console.log(`Pushed secret ${JSON.stringify(sharesWithID)} to user's queue.`);

    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Get n random users from the database who do not own any shares with the given secret ID and are not the given email. */
const randomUsersWithoutSecretIDOrEmail = async (n, secretID, email) => {
    try {
        const collection = db.collection("users");
        const users = await collection.find({ shares: { $not: { $elemMatch: { secretID: secretID } } }, email: { $ne: email } }).toArray();

        return users.sort(() => 0.5 - Math.random()).slice(0, n);
    } catch (e) {
        console.error(e);

        throw e;
    }
};

//* Cycle the given user's queue. */
const cycleQueue = async email => {
    try {
        const collection = db.collection("users");
        const user = await collection.findOne({ email: email });
        var queue = user?.queue || [];
        if (queue.length === 0) {
            return;
        }

        queue.push(queue.shift());

        await collection.updateOne(
            { email: email },
            { $set: { queue: queue } },
        );
        console.log(`Cycled queue for user ${email}.`);
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Try to share a user's shares with other users. Returns true if the first share set is completely shared, false otherwise. */
const shareShares = async email => {
    try {
        const collection = db.collection("users");
        const user = await collection.findOne({ email: email });
        var shares = user?.queue?.[0]?.shares || [];
        const secretID = user?.queue?.[0]?.secretID || null;
        const usersToShareWith = await randomUsersWithoutSecretIDOrEmail(shares.length, secretID, email);
        for (const userToShareWith of usersToShareWith) {
            const share = shares.pop();
            await collection.updateOne(
                { email: userToShareWith.email },
                { $push: { shares: { secretID: secretID, share: share } } }
            );
            await collection.updateOne(
                { email: email },
                { $set: { "queue.0.shares": shares } },
            );
            await collection.updateOne(
                { email: email },
                { $inc: { [`progress.${secretID}`]: 1 } },
            );
            console.log(`Shared share ${share} with ${userToShareWith.email}.`);
        }
        console.log(`Shared ${usersToShareWith.length} shares.`);

        if (shares.length === 0) {
            console.log("No shares remain in first queue position.");
            await collection.updateOne(
                { email: email },
                { $pop: { queue: 1 } }
            );
            return true;
        } else {
            console.log(`${shares.length} shares remain in first queue position.`);
            await cycleQueue(email);

            return false;
        }
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Share a user's shares with other users until the queue is empty or the attempt is exhausted. */
const shareSharesMany = async email => {
    try {
        const collection = db.collection("users");
        const user = await collection.findOne({ email: email });
        const queueLength = user?.queue?.length || 0;
        for (var i = 0; i < queueLength; i++) {
            await shareShares(email);
        }
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Get the ID and progress of all of a user's secrets. */
const getProgressOfAllSecrets = async email => {
    try {
        const collection = db.collection("users");
        const user = await collection.findOne({ email: email });
        const progress = user?.progress || {};

        return Object.entries(progress);
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Delete a user's data from the database. */
const deleteUserData = async email => {
    console.log(`Deleting user ${email}'s data.`);
    try {
        const users = db.collection("users");
        const user = await users.findOne({ email: email });

        const progress = user?.progress || {};
        if (Object.keys(progress).length !== 0) {
            const deletions = db.collection("deletions");
            for (const [secretID, numShares] of Object.entries(progress)) {
                await deletions.insertOne({ secretID: secretID, numShares: numShares });
            }
        }
        console.log(`Inserted ${Object.keys(progress).length} deletions.`);

        const shares = user?.shares || [];
        if (shares.length !== 0) {
            const allUsers = await users.find({}).toArray();
            const otherUsers = allUsers.filter(u => u.email !== email);

            for (const share of shares) {
                const validUsers = otherUsers.filter(u => !Object.keys(u.progress || {}).includes(share.secretID));
                const randomUser = validUsers[Math.floor(Math.random() * validUsers.length)];
                await users.updateOne(
                    { email: randomUser.email },
                    { $push: { shares: share } }
                );
                console.log(`Moved share ${JSON.stringify(share)} to ${randomUser.email}.`);
            }
        }

        await users.deleteOne({ email: email });
        console.log(`Deleted user ${email}'s data.`);
    } catch (e) {
        console.error(e);

        throw e;
    }
};

/** Process the deletions collection. */
const processDeletions = async () => {
    try {
        const deletions = db.collection("deletions");
        const deletion = await deletions.findOne({});
        if (deletion === null) {
            return;
        }

        const users = db.collection("users");
        const usersWithSecretID = await users.find({
            shares: {
                $elemMatch: {
                    secretID: deletion.secretID,
                }
            }
        }).toArray();
        if (usersWithSecretID.length === 0) {
            return;
        }

        for (const user of usersWithSecretID) {
            await users.updateOne(
                { email: user.email },
                { $pull: { shares: { secretID: deletion.secretID } } }
            );
            console.log(`Deleted shares for user ${user.email}.`);
        }
        await deletions.deleteOne({ _id: deletion._id });
        console.log(`Deleted deletion ${deletion._id}.`);
    } catch (e) {
        console.error(e);

        throw e;
    }
};

module.exports.isEmailTaken = isEmailTaken;
module.exports.getUser = getUser;
module.exports.checkPassword = checkPassword;
module.exports.insertUser = insertUser;
module.exports.updateUser = updateUser;
module.exports.pushSecretToQueue = pushSecretToQueue;
module.exports.shareSharesMany = shareSharesMany;
module.exports.getProgressOfAllSecrets = getProgressOfAllSecrets;
module.exports.deleteUserData = deleteUserData;
module.exports.processDeletions = processDeletions;
module.exports.NUM_USERS_TO_SHARE_WITH = NUM_USERS_TO_SHARE_WITH;
