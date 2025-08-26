const transporter = require("../mailer")
const { v4: uuidv4 } = require("uuid")
const dbModule = require("../db")
require('dotenv').config()

const saltRounds = 10

async function sendConfirmationMail(username, email, token) {
    const verificationLink = `http://localhost:3000/verify?token=${token}`

    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Confirm your account",
        text: `Hello ${username},\n\nPlease confirm your account by clicking this link:\n\n${verificationLink}\n\nIf you didn't sign up, ignore this email.`
    })
}

module.exports = async (ws, data) => {
    const { username, email, password } = data

    if (!username || !email || !password) {
        return ws.send(JSON.stringify({
            event: "createAccountFailed",
            message: "All fields required"
        }))
    }

    const db = dbModule.getDb()
    const usersCollection = db.collection("players")

    try {
        const existingUser = await usersCollection.findOne({ username })
        if (existingUser) {
            return ws.send(JSON.stringify({
                event: "createAccountFailed",
                message: "Username already taken"
            }))
        }

        const bcrypt = require("bcrypt")
        const hashedPassword = await bcrypt.hash(password, saltRounds)

        const verificationToken = uuidv4()

        await usersCollection.insertOne({
            username,
            email,
            password: hashedPassword,
            verified: false,
            verificationToken
        })

        await sendConfirmationMail(username, email, verificationToken)

        ws.send(JSON.stringify({
            event: "createAccountSuccess",
            message: "Account created! Please check your email to verify."
        }))

        console.log(`-* Verification email sent to ${username} <${email}>`)
    } catch (err) {
        console.error("Error creating account or sending email:", err)
        ws.send(JSON.stringify({
            event: "createAccountFailed",
            message: "Server error"
        }))
    }
}