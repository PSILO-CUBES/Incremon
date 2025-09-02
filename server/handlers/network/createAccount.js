const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const transporter = require("../../mailer");
const Player = require("../../schema/Player");
require("dotenv").config();

const saltRounds = 10;

// simple in-memory per-IP limiter (restart resets; good enough for dev)
const signupWindowMs = 60 * 60 * 1000; // 1 hour
const maxPerWindow = 5;
const ipCounters = new Map(); // ip -> { count, resetAt }

function allowSignup(ip) {
  const now = Date.now();
  const rec = ipCounters.get(ip);
  if (!rec || rec.resetAt < now) {
    ipCounters.set(ip, { count: 1, resetAt: now + signupWindowMs });
    return true;
    }
  if (rec.count >= maxPerWindow) return false;
  rec.count += 1;
  return true;
}

async function sendConfirmationMail(username, email, token) {
  const base = process.env.VERIFY_BASE_URL || "http://localhost:8080/verify";
  const link = `${base}?token=${token}`;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Confirm your account",
    text:
`Hello ${username},

Please confirm your account by visiting:
${link}

If you didn't sign up, you can ignore this email.`,
  });
}

module.exports = async (ws, data = {}, clientIp = "0.0.0.0") => {
  try {
    const username = (data.username || "").trim();
    const email = (data.email || "").trim().toLowerCase();
    const password = data.password || "";

    if (!allowSignup(clientIp)) {
      return ws.send(JSON.stringify({
        event: "createAccountFailed",
        message: "Too many signups from your IP. Try again later."
      }));
    }

    if (!username || !email || !password) {
      return ws.send(JSON.stringify({
        event: "createAccountFailed",
        message: "All fields required"
      }));
    }

    if (username.length < 3 || password.length < 6) {
      return ws.send(JSON.stringify({
        event: "createAccountFailed",
        message: "Invalid username or password length"
      }));
    }

    // Uniqueness check
    const clash = await Player.findOne({ $or: [{ username }, { email }] })
      .select("_id")
      .lean();
    if (clash) {
      return ws.send(JSON.stringify({
        event: "createAccountFailed",
        message: "Username or email already exists"
      }));
    }

    const passHash = await bcrypt.hash(password, saltRounds);
    const verificationToken = uuidv4();
    const verifyExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // IMPORTANT: do NOT create playerData here.
    await Player.create({
      username,
      email,
      passHash,
      verified: false,
      verificationToken,
      verifyExpiresAt,
    });

    await sendConfirmationMail(username, email, verificationToken);

    ws.send(JSON.stringify({
      event: "createAccountSuccess",
      message: "Account created! Check your email to verify."
    }));
  } catch (err) {
    if (err && err.code === 11000) {
      return ws.send(JSON.stringify({
        event: "createAccountFailed",
        message: "Username or email already exists"
      }));
    }
    console.error("createAccount error:", err);
    try {
      ws.send(JSON.stringify({
        event: "createAccountFailed",
        message: "Server error"
      }));
    } catch {}
  }
};