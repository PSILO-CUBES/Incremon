const loginHandler = require("./login")
const tokenLoginHandler = require("./tokenLogin")
const accountCreationHandler = require("./createAccount")

const handlers = {
    login: loginHandler,
    tokenLogin: tokenLoginHandler,
    createAccount: accountCreationHandler
    // add more actions here
}

function handleMessage(ws, data) {
    const action = data.action
    if (handlers[action]) {
        handlers[action](ws, data)
    } else {
        console.warn("⚠️ Unknown action:", action)
    }
}

module.exports = handleMessage