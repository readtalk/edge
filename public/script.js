let currentWebSocket = null;

let nameForm = document.querySelector("#name-form");
let nameInput = document.querySelector("#name-input");
let roomForm = document.querySelector("#room-form");
let roomNameInput = document.querySelector("#room-name");
let goPublicButton = document.querySelector("#go-public");
let goPrivateButton = document.querySelector("#go-private");
let chatroom = document.querySelector("#chatroom");
let chatlog = document.querySelector("#chatlog");
let chatInput = document.querySelector("#chat-input");
let roster = document.querySelector("#roster");

let isAtBottom = true;
let username;
let roomname;

let hostname = window.location.host;
if (hostname == "") {
  hostname = "edge.readtalk.workers.dev";
}

function startNameChooser() {
  nameForm.addEventListener("submit", event => {
    event.preventDefault();
    username = nameInput.value;
    if (username.length > 0) {
      startRoomChooser();
    }
  });

  nameInput.addEventListener("input", event => {
    if (event.currentTarget.value.length > 32) {
      event.currentTarget.value = event.currentTarget.value.slice(0, 32);
    }
  });

  nameInput.focus();
}

function startRoomChooser() {
  nameForm.style.display = "none";  // ✅ SEMBUNYIKAN, bukan remove()
  roomForm.style.display = "flex";

  if (document.location.hash.length > 1) {
    roomname = document.location.hash.slice(1);
    startChat();
    return;
  }

  roomForm.addEventListener("submit", event => {
    event.preventDefault();
    roomname = roomNameInput.value;
    if (roomname.length > 0) {
      startChat();
    }
  });

  roomNameInput.addEventListener("input", event => {
    if (event.currentTarget.value.length > 32) {
      event.currentTarget.value = event.currentTarget.value.slice(0, 32);
    }
  });

  goPublicButton.addEventListener("click", event => {
    roomname = roomNameInput.value;
    if (roomname.length > 0) {
      startChat();
    }
  });

  goPrivateButton.addEventListener("click", async event => {
    roomNameInput.disabled = true;
    goPublicButton.disabled = true;
    event.currentTarget.disabled = true;

    let response = await fetch("https://" + hostname + "/api/room", {method: "POST"});
    if (!response.ok) {
      alert("something went wrong");
      document.location.reload();
      return;
    }

    roomname = await response.text();
    startChat();
  });

  roomNameInput.focus();
}

function startChat() {
  roomForm.style.display = "none";  // ✅ SEMBUNYIKAN, bukan remove()

  roomname = roomname.replace(/[^a-zA-Z0-9_-]/g, "").replace(/_/g, "-").toLowerCase();

  if (roomname.length > 32 && !roomname.match(/^[0-9a-f]{64}$/)) {
    addChatMessage("ERROR", "Invalid room name.");
    return;
  }

  document.location.hash = "#" + roomname;

  chatInput.addEventListener("keydown", event => {
    if (event.keyCode == 38) {
      chatlog.scrollBy(0, -50);
    } else if (event.keyCode == 40) {
      chatlog.scrollBy(0, 50);
    } else if (event.keyCode == 33) {
      chatlog.scrollBy(0, -chatlog.clientHeight + 50);
    } else if (event.keyCode == 34) {
      chatlog.scrollBy(0, chatlog.clientHeight - 50);
    }
  });

  chatroom.addEventListener("submit", event => {
    event.preventDefault();

    if (currentWebSocket) {
      currentWebSocket.send(JSON.stringify({message: chatInput.value}));
      chatInput.value = "";
      chatlog.scrollBy(0, 1e8);
    }
  });

  chatInput.addEventListener("input", event => {
    if (event.currentTarget.value.length > 256) {
      event.currentTarget.value = event.currentTarget.value.slice(0, 256);
    }
  });

  chatlog.addEventListener("scroll", event => {
    isAtBottom = chatlog.scrollTop + chatlog.clientHeight >= chatlog.scrollHeight;
  });

  chatInput.focus();
  document.body.addEventListener("click", event => {
    if (window.getSelection().toString() == "") {
      chatInput.focus();
    }
  });

  if('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', function(event) {
      if (isAtBottom) {
        chatlog.scrollBy(0, 1e8);
      }
    });
  }

  join();
}

let lastSeenTimestamp = 0;
let wroteWelcomeMessages = false;

function join() {
  const wss = document.location.protocol === "http:" ? "ws://" : "wss://";
  let ws = new WebSocket(wss + hostname + "/api/room/" + roomname + "/websocket");
  let rejoined = false;
  let startTime = Date.now();

  let rejoin = async () => {
    if (!rejoined) {
      rejoined = true;
      currentWebSocket = null;

      while (roster.firstChild) {
        roster.removeChild(roster.firstChild);
      }

      let timeSinceLastJoin = Date.now() - startTime;
      if (timeSinceLastJoin < 10000) {
        await new Promise(resolve => setTimeout(resolve, 10000 - timeSinceLastJoin));
      }

      join();
    }
  }

  ws.addEventListener("open", event => {
    currentWebSocket = ws;
    ws.send(JSON.stringify({name: username}));
  });

  ws.addEventListener("message", event => {
    let data = JSON.parse(event.data);

    if (data.error) {
      addChatMessage(null, "* Error: " + data.error);
    } else if (data.joined) {
      let p = document.createElement("p");
      p.innerText = data.joined;
      roster.appendChild(p);
    } else if (data.quit) {
      for (let child of roster.childNodes) {
        if (child.innerText == data.quit) {
          roster.removeChild(child);
          break;
        }
      }
    } else if (data.ready) {
      if (!wroteWelcomeMessages) {
        wroteWelcomeMessages = true;
        addChatMessage(null,
            "* This is a demo app built with Cloudflare Workers Durable Objects. The source code " +
            "can be found at: https://github.com/cloudflare/workers-chat-demo");
        addChatMessage(null,
            "* WARNING: Participants in this chat are random people on the internet. " +
            "Names are not authenticated; anyone can pretend to be anyone. The people " +
            "you are chatting with are NOT Cloudflare employees. Chat history is saved.");
        if (roomname.length == 64) {
          addChatMessage(null,
              "* This is a private room. You can invite someone to the room by sending them the URL.");
        } else {
          addChatMessage(null,
              "* Welcome to #" + roomname + ". Say hi!");
        }
      }
    } else {
      if (data.timestamp > lastSeenTimestamp) {
        addChatMessage(data.name, data.message);
        lastSeenTimestamp = data.timestamp;
      }
    }
  });

  ws.addEventListener("close", event => {
    console.log("WebSocket closed, reconnecting:", event.code, event.reason);
    rejoin();
  });
  ws.addEventListener("error", event => {
    console.log("WebSocket error, reconnecting:", event);
    rejoin();
  });
}

function addChatMessage(name, text) {
  let p = document.createElement("p");
  if (name) {
    let tag = document.createElement("span");
    tag.className = "username";
    tag.innerText = name + ": ";
    p.appendChild(tag);
  }
  p.appendChild(document.createTextNode(text));

  chatlog.appendChild(p);
  if (isAtBottom) {
    chatlog.scrollBy(0, 1e8);
  }
}

startNameChooser();
