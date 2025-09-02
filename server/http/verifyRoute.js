const express = require("express");
const Player = require("../schema/Player");

const router = express.Router();

/**
 * GET /verify?token=...
 * Marks the user as verified and removes the TTL field so the account won't be purged.
 */
router.get("/verify", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send("Missing token");

    const player = await Player.findOne({ verificationToken: token }).select("_id verified");
    if (!player) return res.status(400).send("Invalid or expired token");

    if (player.verified) {
      return res.status(200).send("Your account is already verified. You can log in.");
    }

    await Player.updateOne(
      { _id: player._id },
      {
        $set: { verified: true, verifiedAt: new Date() },
        $unset: { verificationToken: "", verifyExpiresAt: "" }
      }
    );

    res.status(200).send("Your account has been verified! You can now log in.");
  } catch (err) {
    console.error("verify route error:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;