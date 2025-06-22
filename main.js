import { auth, provider, firestore, rtdb } from './firebase-config.js';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  getDocs,
  setDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp as dbServerTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// DOM 元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const chatSection = document.getElementById("chat-section");
const loginCard = document.getElementById("login-card");
const chatBox = document.getElementById("chat-box");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const roomInput = document.getElementById("room-name");
const joinRoomBtn = document.getElementById("join-room");
const presenceList = document.getElementById("presence-list");
const roomList = document.getElementById("room-list");

// 狀態
let currentRoom = "";
let unsubscribe = null;

// 登入與登出
loginBtn.onclick = () => signInWithPopup(auth, provider);
logoutBtn.onclick = () => signOut(auth);

// 登入狀態變化
onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `👋 ${user.displayName}`;
    loginCard.style.display = "none";
    chatSection.style.display = "flex";
    logoutBtn.style.display = "inline-block";
    loginBtn.style.display = "none";
    setupPresence(user);
    watchPresence();
    loadRoomList(); // 🔥 取得聊天室清單
  } else {
    userInfo.textContent = "";
    loginCard.style.display = "block";
    chatSection.style.display = "none";
    logoutBtn.style.display = "none";
    loginBtn.style.display = "inline-block";
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    chatBox.innerHTML = "";
    if (unsubscribe) unsubscribe();
  }
});

// 加入聊天室
joinRoomBtn.onclick = async () => {
  const room = roomInput.value.trim();
  if (!room) return alert("請輸入聊天室名稱");

  currentRoom = room;
  if (unsubscribe) unsubscribe();

  // 建立聊天室記錄（如果不存在）
  await setDoc(doc(firestore, "rooms", room), {
    createdAt: serverTimestamp()
  }, { merge: true });

  // 監聽訊息
  const msgsRef = collection(firestore, "rooms", currentRoom, "messages");
  const q = query(msgsRef, orderBy("timestamp"));

  unsubscribe = onSnapshot(q, snap => {
    chatBox.innerHTML = "";
    const uid = auth.currentUser?.uid;

    snap.forEach(doc => {
      const msg = doc.data();
      const time = msg.timestamp?.toDate().toLocaleTimeString() || "";
      const side = msg.uid === uid ? "you" : "other";

      const row = document.createElement("div");
      row.className = `message-row ${side}`;

      const avatarText = document.createElement("div");
      avatarText.className = "avatar-text";
      avatarText.textContent = msg.user ? msg.user[0].toUpperCase() : "?";

      const bubble = document.createElement("div");
      bubble.className = `message ${side}`;
      bubble.innerHTML = `
        <span class="message-text">${msg.text}</span>
        <span class="message-time">${time}</span>
      `;

      if (side === "you") {
        row.appendChild(bubble);
        row.appendChild(avatarText);
      } else {
        row.appendChild(avatarText);
        row.appendChild(bubble);
      }

      chatBox.appendChild(row);
    });

    chatBox.scrollTop = chatBox.scrollHeight;
  });

  watchTyping();     // 🔥 啟動正在輸入提示
  loadRoomList();    // 🔥 更新聊天室清單
};

// 發送訊息
sendBtn.onclick = async () => {
  const text = messageInput.value.trim();
  const user = auth.currentUser;
  if (!text || !user || !currentRoom) return;

  await addDoc(collection(firestore, "rooms", currentRoom, "messages"), {
    user: user.displayName,
    uid: user.uid,
    text,
    timestamp: serverTimestamp()
  });

  messageInput.value = "";
};

// 在線狀態追蹤
function setupPresence(user) {
  const userRef = ref(rtdb, "presence/" + user.uid);
  const connRef = ref(rtdb, ".info/connected");

  const onlineObj = {
    state: "online",
    displayName: user.displayName,
    last_changed: dbServerTimestamp()
  };
  const offlineObj = {
    state: "offline",
    last_changed: dbServerTimestamp()
  };

  onValue(connRef, snap => {
    if (snap.val() === false) return;
    onDisconnect(userRef).set(offlineObj).then(() => {
      set(userRef, onlineObj);
    });
  });
}

function watchPresence() {
  const allRef = ref(rtdb, "presence");
  onValue(allRef, snap => {
    const users = snap.val() || {};
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    for (const uid in users) {
      if (users[uid].state === "online") {
        const div = document.createElement("div");
        div.textContent = users[uid].displayName || uid;
        presenceList.appendChild(div);
      }
    }
  });
}

// 🔥 顯示誰正在輸入中
const typingNotice = document.createElement("div");
typingNotice.id = "typing-indicator";
chatBox.parentElement.appendChild(typingNotice);

function watchTyping() {
  const typingRef = ref(rtdb, `typing/${currentRoom}`);
  onValue(typingRef, (snap) => {
    const data = snap.val() || {};
    const othersTyping = Object.values(data)
      .filter(u => u.name !== auth.currentUser?.displayName)
      .map(u => u.name);

    typingNotice.textContent = othersTyping.length
      ? `${othersTyping.join("、")} 正在輸入...`
      : "";
  });
}

let typingTimeout;
messageInput.addEventListener("input", () => {
  const user = auth.currentUser;
  if (!user || !currentRoom) return;

  const typingRef = ref(rtdb, `typing/${currentRoom}/${user.uid}`);
  set(typingRef, { name: user.displayName });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    set(typingRef, null);
  }, 2000);
});

// 🔥 載入聊天室清單
async function loadRoomList() {
  const roomsRef = collection(firestore, "rooms");
  const snap = await getDocs(roomsRef);
  roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';

  snap.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.id;
    roomList.appendChild(opt);
  });

  roomList.onchange = () => {
    roomInput.value = roomList.value;
  };
}
