const nodemailer = require("nodemailer");

// you probably want to configure this once and reuse
const transporter = nodemailer.createTransport({
    host: "mail.incremon.com",    // Namecheap mail server
    port: 465,                     // SSL port
    secure: true,                  // use SSL
    auth: {
        user: "contact@incremon.com",
        pass: "X#Le%K5;@..)XU." // your Namecheap mailbox password
    }
});

module.exports = async (ws, data) => {
    const { name, email, message } = data;

    if (!name || !email || !message) {
        return ws.send(JSON.stringify({
            event: "createAccountFailed",
            message: "All fields required"
        }));
    }

    try {
        await transporter.sendMail({
            from: "youremail@gmail.com",
            to: "destination@example.com",
            subject: "Form Submission",
            text: `Name: ${name}\nEmail: ${email}\nMessage: ${message}`
        });

        ws.send(JSON.stringify({
            event: "createAccountSuccess",
            message: "Form submitted successfully"
        }));

        console.log(`📧 Email sent from ${name} <${email}>`);
    } catch (err) {
        console.error("Mailer error:", err);
        ws.send(JSON.stringify({
            event: "createAccountFailed",
            message: "Server error"
        }));
    }
};