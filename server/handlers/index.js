const gatherHandler = require("./gather");
const chatHandler = require("./chat");
const loginHandler = require("./login")

const handlers = {
  gather: gatherHandler,
  chat: chatHandler,
  login: loginHandler,
  // add more actions here
};

function handleMessage(ws, data) {
  const action = data.action;
  if (handlers[action]) {
    handlers[action](ws, data);
  } else {
    console.warn("⚠️ Unknown action:", action);
  }
}

module.exports = handleMessage;