const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const db = require("./db");

const app = express();
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", async (req, res) => {
    if (req.cookies.loggedIn === undefined) {
        res.redirect("/login");
        return;
    }

    const placeholders = [
        "i like pineapple on pizza",
        "i don't like chocolate",
        "i like to eat cereal for dinner",
        "i sing loudly in the shower",
        "i am scared of the dark",
        "i have a pet turtle",
        "i can't whistle",
        "my favorite color is blue",
    ];

    const user = await db.getUser(req.cookies.loggedIn.email);
    await db.shareSharesMany(req.cookies.loggedIn.email);

    const progress = await db.getProgressOfAllSecrets(req.cookies.loggedIn.email);
    const secrets = progress.map((secret) => ({
        secretID: secret[0],
        progress: secret[1],
    }));

    const shares = user.shares?.map((share) => share.share);

    res.render("index", {
        name: user.name,
        placeholder: placeholders[Math.floor(Math.random() * placeholders.length)],
        secrets: secrets,
        NUM_USERS_TO_SHARE_WITH: db.NUM_USERS_TO_SHARE_WITH,
        shares: shares,
    });
});

app.get("/login", (req, res) => {
    if (req.cookies.loggedIn) {
        res.redirect("/");
        return;
    }
    res.render("login", { givenEmail: null, error: null });
});

app.get("/signup", (req, res) => {
    if (req.cookies.loggedIn) {
        res.redirect("/");
        return;
    }
    res.render("signup", { givenName: null, givenEmail: null, error: null });
});

app.get("/about", (req, res) =>
    res.render("about", {
        NUM_USERS_TO_SHARE_WITH: db.NUM_USERS_TO_SHARE_WITH,
        loggedIn: req.cookies.loggedIn !== undefined,
    }),
);

app.get("/logout", (_req, res) => {
    res.clearCookie("loggedIn");
    res.redirect("/");
});

app.get("/settings", async (req, res) => {
    if (req.cookies.loggedIn === undefined) {
        res.redirect("/");
        return;
    }

    const user = await db.getUser(req.cookies.loggedIn.email);

    res.render("settings", {
        name: user.name,
        email: user.email,
        givenName: null,
        givenEmail: null,
        error: null,
        success: null,
    });
});

app.get("/delete", (req, res) => {
    if (req.cookies.loggedIn === undefined) {
        res.redirect("/");
        return;
    }
    res.render("delete");
});

app.post("/settings", async (req, res) => {
    const user = await db.getUser(req.cookies.loggedIn.email);

    if (req.body.name.length > 0 && req.body.name.includes(" ")) {
        res.render("settings", {
            name: user.name,
            email: user.email,
            givenName: req.body.name,
            givenEmail: null,
            error: { type: "name", message: "only your first name please, no spaces <3" },
            success: null,
        });
    } else if (req.body.email.length > 0 && !isValidEmail(req.body.email)) {
        res.render("settings", {
            name: user.name,
            email: user.email,
            givenName: req.body.name,
            givenEmail: req.body.email,
            error: { type: "email", message: "please enter a valid email address xoxo" },
            success: null,
        });
    } else if (await db.isEmailTaken(req.body.email)) {
        res.render("settings", {
            name: user.name,
            email: user.email,
            givenName: req.body.name,
            givenEmail: req.body.email,
            error: { type: "email", message: "this email is already taken </3" },
            success: null,
        });
    } else {
        const newName = req.body.name.length !== 0 ? req.body.name : user.name;
        const newEmail = req.body.email.length !== 0 ? req.body.email : user.email;

        await db.updateUser(user.email, {
            name: newName,
            email: newEmail,
        });

        if (newEmail !== user.email) {
            res.clearCookie("loggedIn");
            logUserIn(res, newEmail);
        }

        res.render("settings", {
            name: newName,
            email: newEmail,
            givenName: null,
            givenEmail: null,
            error: null,
            success: { message: "settings saved!" },
        });
    }
});

app.post("/login", async (req, res) => {
    const user = await db.getUser(req.body.email);
    if (!isValidEmail(req.body.email)) {
        res.render("login", {
            givenEmail: req.body.email,
            error: { type: "email", message: "please enter a valid email address xoxo" },
        });
        return;
    } else if (user === null) {
        res.render("login", {
            givenEmail: req.body.email,
            error: {
                type: "email",
                message: "no user exists with that email </3",
            },
        });
        return;
    }

    const passwordIsCorrect = await db.checkPassword(
        req.body.email,
        req.body.password,
    );
    if (!passwordIsCorrect) {
        res.render("login", {
            givenEmail: req.body.email,
            error: { type: "password", message: "incorrect password </3" },
        });
        return;
    }

    await logUserIn(res, req.body.email);

    res.redirect("/");
});

app.post("/signup", async (req, res) => {
    if (req.body.name.length > 0 && req.body.name.includes(" ")) {
        res.render("signup", {
            givenName: req.body.name,
            givenEmail: req.body.email,
            error: {
                type: "name",
                message: "only your first name please, no spaces <3",
            },
        });
    } else if (!isValidEmail(req.body.email)) {
        res.render("signup", {
            givenName: req.body.name,
            givenEmail: req.body.email,
            error: {
                type: "email",
                message: "please enter a valid email address xoxo",
            },
        });
    } else if (await db.isEmailTaken(req.body.email)) {
        res.render("signup", {
            givenName: req.body.name,
            givenEmail: req.body.email,
            error: {
                type: "email",
                message: "this email is already taken </3",
            },
        });
    } else {
        await db.insertUser(req.body);
        await logUserIn(res, req.body.email);

        res.redirect("/");
    }
});

app.post("/", async (req, res) => {
    await db.pushSecretToQueue(req.cookies.loggedIn.email, req.body.secret);

    res.redirect("/");
});

app.post("/delete", async (req, res) => {
    await db.deleteUserData(req.cookies.loggedIn.email);
    res.clearCookie("loggedIn");

    res.redirect("/");
});

const logUserIn = async (res, email) =>
    res.cookie(
        "loggedIn",
        {
            email: email,
        },
        {
            maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
            httpOnly: true,
        },
    );

const isValidEmail = email => /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/.test(email);

const PORT = 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}.`));
