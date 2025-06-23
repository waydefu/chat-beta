// main.js
import { auth, provider, firestore, rtdb, app } from './firebase-config.js';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  getDocs,
  setDoc,
  doc,
  updateDoc,
  arrayUnion,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp as dbServerTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// === DOM 元素 ===
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const chatSection = document.getElementById('chat-section');
const loginCard = document.getElementById('login-card');
const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const roomInput = document.getElementById('room-name');
const joinRoomBtn = document.getElementById('join-room');
const presenceList = document.getElementById('presence-list');
const roomList = document.getElementById('room-list');
const typingIndicator = document.getElementById('typing-indicator'); // 直接引用現有元素

// === 狀態 ===
let currentRoom = '';
let unsubscribe = null;
const userNameCache = new Map(); // 快取 UID -> 顯示名稱

// === 工具函數 ===
function sanitizeInput(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 查詢使用者顯示名稱
async function getUserDisplayName(uid) {
  if (userNameCache.has(uid)) {
    return userNameCache.get(uid);
  }
  try {
    const userDoc = await getDoc(doc(firestore, 'users', uid));
    const displayName = userDoc.exists() ? userDoc.data().displayName : '未知使用者';
    userNameCache.set(uid, displayName);
    return displayName;
  } catch (error) {
    console.error('查詢使用者名稱失敗：', uid, error.message);
    return '未知使用者';
  }
}

// 渲染單條訊息
async function appendMessage(msg, uid) {
  let time = '';
  let timestampDate;

  try {
    if (msg.timestamp instanceof Date) { // 如果已經是 JS Date 物件 (例如從本地快照手動處理)
      timestampDate = msg.timestamp;
    } else if (msg.timestamp && typeof msg.timestamp.toDate === 'function') {
      // 這是 Firebase Timestamp 物件的標準處理方式
      timestampDate = msg.timestamp.toDate();
    } else {
      // 如果 msg.timestamp 為 null、undefined，或是一個沒有 toDate() 方法的物件
      // (例如 serverTimestamp() 的本地待處理狀態，或者 Firestore 數據中 timestamp 欄位缺失)
      // 對於您自己發送的訊息，如果 timestamp 仍有問題，我們使用客戶端的當前時間來即時顯示。
      if (msg.uid === uid) { // 這是您的訊息
          console.warn('您的訊息時間戳異常，使用本地時間作為回退。訊息ID:', msg.id, '原始值:', msg.timestamp);
          timestampDate = new Date(); // 使用當前瀏覽器的本地時間來即時顯示
      } else { // 這是其他人的訊息，如果時間戳缺失或異常，可能是數據問題。
          console.warn('對方訊息時間戳缺失或異常，使用本地時間作為回退。訊息ID:', msg.id, '原始值:', msg.timestamp);
          timestampDate = new Date(); // 仍然使用當前時間作為最安全的備用
      }
    }

    // 格式化時間
    time = timestampDate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

  } catch (error) {
    console.error('處理訊息時間戳時發生錯誤：', msg.id, error.message, '原始時間戳:', msg.timestamp);
    time = '未知時間'; // 發生任何錯誤時最終顯示
  }

  const side = msg.uid === uid ? 'you' : 'other';

  let readByText = '';
  let isReadByMe = false; // 新增變數判斷是否被當前用戶讀取

  if (msg.readBy && Array.isArray(msg.readBy) && msg.readBy.length > 0) {
    const readByNames = await Promise.all(msg.readBy.map(getUserDisplayName));
    readByText = `已讀：${readByNames.join('、')}`;
    isReadByMe = msg.readBy.includes(uid); // 判斷是否包含當前用戶 UID
  } else {
      readByText = '無人已讀'; // 如果 readBy 不存在或為空陣列
  }
  
  const row = document.createElement('div');
  row.className = `message-row ${side}`;
  // 為 message-row 添加 data-msg-id 屬性，以便在 modified 時查找
  row.setAttribute('data-msg-id', msg.id);

  const avatarText = document.createElement('div');
  avatarText.className = 'avatar-text';
  avatarText.textContent = msg.user ? msg.user[0].toUpperCase() : '?';

  const bubble = document.createElement('div');
  bubble.className = `message ${side}`;
  // 確保 aria-label 中的文本也進行了 sanitized
  bubble.setAttribute('aria-label', `${msg.user} 說：${sanitizeInput(msg.text)}，時間：${time}`);
  // 為 message 添加 data-msg-id 屬性，以便在 modified 時查找
  bubble.setAttribute('data-msg-id', msg.id); 
  bubble.innerHTML = `
    <span class="message-text">${sanitizeInput(msg.text)}</span>
    <span class="message-time">${time}</span>
    <span class="read-status" data-msg-id="${msg.id}" title="${readByText}">${isReadByMe ? '✔' : ''}</span>
  `;

  if (side === 'you') {
    row.appendChild(bubble);
    row.appendChild(avatarText);
  } else {
    row.appendChild(avatarText);
    row.appendChild(bubble);
  }

  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// 標記訊息為已讀 (增加日誌)
async function markMessageAsRead(msgId, uid) {
  console.log(`嘗試標記訊息 ${msgId} 為 UID ${uid} 已讀...`);
  try {
    const msgRef = doc(firestore, 'rooms', currentRoom, 'messages', msgId);
    await updateDoc(msgRef, {
      readBy: arrayUnion(uid)
    });
    console.log(`訊息 ${msgId} 已成功標記為 UID ${uid} 已讀。`);
  } catch (error) {
    console.error(`標記訊息 ${msgId} 為 UID ${uid} 已讀失敗：`, error.message, error.code, error);
    // alert('無法標記訊息為已讀，請檢查權限或網路'); // 這裡可以選擇是否彈出警告
  }
}

// === 身份驗證 ===
loginBtn.onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error('登入失敗：', error);
    alert(`登入失敗：${error.message}`);
  }
};

logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('登出失敗：', error);
    alert('無法登出，請稍後重試');
  }
};

onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `👋 ${user.displayName}`;
    loginCard.style.display = 'none';
    chatSection.style.display = 'flex';
    logoutBtn.style.display = 'inline-block';
    loginBtn.style.display = 'none';
    chatBox.setAttribute('role', 'log');
    chatBox.setAttribute('aria-live', 'polite');
    setDoc(doc(firestore, 'users', user.uid), {
      displayName: user.displayName || '匿名使用者'
    }, { merge: true }).catch(error => {
      console.error('儲存使用者名稱失敗：', error.message);
    });
    setupPresence(user);
    watchPresence();
    watchRoomList();
    watchTyping(); // 啟動 typing 監聽
  } else {
    userInfo.textContent = '';
    loginCard.style.display = 'block';
    chatSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginBtn.style.display = 'inline-block';
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    chatBox.innerHTML = '';
    roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';
    if (typingIndicator) typingIndicator.textContent = ''; // 清除 typing 提示
    if (unsubscribe) unsubscribe();
    userNameCache.clear();
  }
});

// === 聊天室管理 ===
joinRoomBtn.onclick = async () => {
  try {
    const room = roomInput.value.trim();
    if (!room) return alert('請輸入聊天室名稱');

    console.log(`嘗試加入/建立聊天室: ${room}`);
    joinRoomBtn.disabled = true;
    joinRoomBtn.textContent = '載入中...';

    // 儲存新的聊天室名稱到狀態變數
    currentRoom = room;

    // 如果之前有監聽器，先取消訂閱
    if (unsubscribe) {
      unsubscribe();
      console.log('已取消之前的訊息監聽。');
    }

    // 確保房間文檔存在 (如果不存在則創建，如果存在則合併)
    await setDoc(doc(firestore, 'rooms', room), {
      createdAt: serverTimestamp()
    }, { merge: true });
    console.log(`聊天室文檔 '${room}' 已確保存在。`);


    // 設置 Firestore 訊息監聽器
    const msgsRef = collection(firestore, 'rooms', currentRoom, 'messages');
    const q = query(msgsRef, orderBy('timestamp'));

    unsubscribe = onSnapshot(q, snap => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        console.warn('用戶未登入，無法處理訊息快照。');
        return;
      }

      snap.docChanges().forEach(async change => {
        const msg = { id: change.doc.id, ...change.doc.data() };

        if (change.type === 'added') {
          console.log('--- 收到新訊息快照 (added) ---');
          console.log('訊息 ID:', msg.id);
          console.log('完整訊息數據 (原始):', msg); // 顯示原始數據
          console.log('訊息 UID:', msg.uid, '當前用戶 UID:', uid);
          console.log('訊息 readBy 陣列 (added):', msg.readBy); // 顯示 readBy 陣列內容 (added 事件時)
          console.log('時間戳欄位:', msg.timestamp);
          console.log('時間戳是否有 toDate 方法:', typeof msg.timestamp?.toDate);
          
          await appendMessage(msg, uid);

          // 判斷是否需要標記為已讀 (針對非自己發送的訊息)
          // 條件：訊息不是當前用戶發送的 (msg.uid !== uid) 且 當前用戶不在 readBy 陣列中
          if (msg.uid !== uid && (!msg.readBy || !msg.readBy.includes(uid))) {
            console.log(`判斷需要標記訊息 ${msg.id} 為 UID ${uid} 已讀...`);
            await markMessageAsRead(msg.id, uid);
          } else {
            console.log(`訊息 ${msg.id} 不需要標記為 UID ${uid} 已讀。`);
            console.log(`原因: 訊息是否為本人發送: ${msg.uid === uid}, 是否已包含在 readBy: ${msg.readBy?.includes(uid)}`);
          }
          console.log('--- added 快照處理結束 ---');

        } else if (change.type === 'modified') {
            // 當訊息被修改時 (例如，readBy 陣列被更新)
            console.log('--- 收到訊息更新快照 (modified) ---');
            console.log('訊息 ID:', msg.id);
            console.log('更新後的完整訊息數據:', msg);
            console.log('更新後的 readBy 陣列 (modified):', msg.readBy); // 顯示 readBy 陣列內容 (modified 事件時)

            // 查找 DOM 中現有的訊息元素並更新其已讀狀態
            // 我們查找 `message-row`，因為它是完整的訊息容器
            const existingMessageRow = chatBox.querySelector(`.message-row[data-msg-id="${msg.id}"]`);
            if (existingMessageRow) {
                // 移除舊的訊息行元素
                existingMessageRow.remove();
                // 重新呼叫 appendMessage，將新的數據渲染到 chatBox 中
                // 這是最簡單也最穩妥的更新方式，確保所有狀態都是最新的
                console.log(`重新渲染訊息 ${msg.id} 以更新已讀狀態。`);
                await appendMessage(msg, uid);
            } else {
                console.warn(`未找到 ID 為 ${msg.id} 的現有訊息元素，無法更新已讀狀態。`);
            }
            console.log('--- modified 快照處理結束 ---');
        }
        // 如果訊息可以被刪除，您可能還需要處理 'removed' 類型
      });
    }, error => {
      console.error('監聽訊息失敗：', error);
      alert('無法載入訊息，請稍後重試');
    });
    console.log(`已設定聊天室 '${currentRoom}' 的訊息監聽。`);

    watchTyping(); // 啟動或更新 typing 監聽
    console.log('已啟動打字狀態監聽。');

  } catch (error) {
    console.error('加入聊天室失敗：', error.message, error.code, '詳細錯誤對象:', error);
    alert(`加入聊天室失敗：${error.message}`);
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = '加入 / 建立聊天室';
    console.log('加入聊天室操作結束。');
  }
};


// 即時監聽聊天室清單
function watchRoomList() {
  const roomsRef = collection(firestore, 'rooms');
  onSnapshot(roomsRef, snap => {
    roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';
    snap.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.id;
      roomList.appendChild(opt);
    });
  }, error => {
    console.error('監聽聊天室清單失敗：', error);
    alert('無法載入聊天室清單，請稍後重試');
  });
}

roomList.onchange = () => {
  roomInput.value = roomList.value;
  // 自動觸發加入房間
  joinRoomBtn.click();
};

// === 訊息發送 ===
sendBtn.onclick = async () => {
  console.log('--- 嘗試發送訊息 ---');
  try {
    const text = messageInput.value.trim();
    const user = auth.currentUser;

    console.log('訊息內容:', text ? text.substring(0, Math.min(text.length, 50)) + (text.length > 50 ? '...' : '') : '[空]');
    console.log('當前用戶:', user ? user.displayName : '[未登入]');
    console.log('當前聊天室:', currentRoom || '[未選擇]');

    if (!text) {
      console.warn('發送失敗：訊息內容為空。');
      return;
    }
    if (!user) {
      console.warn('發送失敗：用戶未登入。');
      alert('請先登入才能發送訊息！');
      return;
    }
    if (!currentRoom) {
      console.warn('發送失敗：未加入任何聊天室。');
      alert('請先加入或建立一個聊天室！');
      return;
    }

    const messageData = {
      user: user.displayName,
      uid: user.uid,
      text: text,
      timestamp: serverTimestamp(), // Firestore 的伺服器時間戳
      readBy: [user.uid] // 訊息發送者自己默認為已讀
    };
    console.log('準備發送的訊息數據:', messageData);

    const messageRef = await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), messageData);

    console.log('訊息已成功發送到 Firestore，ID：', messageRef.id);
    messageInput.value = ''; // 清空輸入框
    messageInput.style.height = 'auto'; // 重置輸入框高度

  } catch (error) {
    console.error('發送訊息失敗：', error.message, error.code, '詳細錯誤對象:', error);
    alert(`無法發送訊息，請稍後重試：${error.message}`);
  } finally {
    console.log('--- 訊息發送嘗試結束 ---');
  }
};


messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

// === 在線狀態 ===
function setupPresence(user) {
  const userRef = ref(rtdb, 'presence/' + user.uid);
  const connRef = ref(rtdb, '.info/connected');

  const onlineObj = {
    state: 'online',
    displayName: user.displayName || '匿名使用者',
    last_changed: dbServerTimestamp()
  };
  const offlineObj = {
    state: 'offline',
    displayName: user.displayName || '匿名使用者',
    last_changed: dbServerTimestamp()
  };

  onValue(connRef, snap => {
    console.log('連線狀態:', snap.val());
    if (snap.val() === false) {
      console.log('已斷線:', user.uid);
      // 如果不是顯式斷開，Firebase 會自動處理離線
      return;
    }
    // 設置 onDisconnect 處理器，確保瀏覽器關閉時狀態設為離線
    onDisconnect(userRef).set(offlineObj).then(() => {
      // 一旦設置了 onDisconnect，就設置當前狀態為在線
      set(userRef, onlineObj).then(() => {
        console.log('設置在線狀態成功：', user.uid, onlineObj);
      }).catch(error => {
        console.error('設置在線狀態失敗：', user.uid, error.message);
      });
    }).catch(error => {
      console.error('設置斷線處理失敗：', user.uid, error.message);
    });
  }, error => {
    console.error('監聽連線狀態失敗：', error.message);
  });
}

function watchPresence() {
  const allRef = ref(rtdb, 'presence');
  onValue(allRef, snap => {
    const users = snap.val() || {};
    // console.log('在線數據:', users); // 避免頻繁日誌
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    const onlineUsers = Object.values(users).filter(u => u?.state === 'online');

    if (onlineUsers.length === 0) {
      const div = document.createElement('div');
      div.textContent = '無在線使用者';
      presenceList.appendChild(div);
    } else {
      onlineUsers.forEach(u => {
        const div = document.createElement('div');
        div.textContent = u.displayName || '匿名使用者';
        presenceList.appendChild(div);
      });
    }
  }, error => {
    console.error('監聽在線使用者失敗：', error.message, error.code);
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3><div>無法載入使用者列表：${error.message}</div>`;
  });
}

// === 正在輸入提示 ===
function watchTyping() {
  if (!currentRoom) return;
  const typingRef = ref(rtdb, `typing/${currentRoom}`);
  onValue(typingRef, snap => {
    try {
      const data = snap.val() || {};
      const currentUserDisplayName = auth.currentUser?.displayName;
      const othersTyping = Object.values(data)
        .filter(u => u && u.name !== currentUserDisplayName) // 過濾掉自己
        .map(u => u.name);

      if (typingIndicator) {
        typingIndicator.textContent = othersTyping.length
          ? `${othersTyping.join('、')} 正在輸入...`
          : '';
      }
    } catch (error) {
      console.error('處理打字數據失敗：', error.message);
      if (typingIndicator) typingIndicator.textContent = '無法載入輸入狀態';
    }
  }, error => {
    console.error('監聽打字狀態失敗：', error.message);
    if (typingIndicator) typingIndicator.textContent = '無法載入輸入狀態';
  });
}

let typingTimeout;
messageInput.addEventListener('input', () => {
  const user = auth.currentUser;
  if (!user || !currentRoom) return;

  const typingRef = ref(rtdb, `typing/${currentRoom}/${user.uid}`);
  clearTimeout(typingTimeout);

  if (!typingTimeout) { // 僅在第一次打字時設置狀態
    set(typingRef, { name: user.displayName })
      .catch(error => console.error('設置打字狀態失敗：', error.message));
  }
  typingTimeout = setTimeout(() => {
    // 2 秒後清除打字狀態
    set(typingRef, null)
      .catch(error => console.error('清除打字狀態失敗：', error.message));
    typingTimeout = null;
  }, 2000);
});

// === 動態調整輸入框高度 ===
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
});