import { auth, provider, firestore, rtdb } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, doc, updateDoc, arrayUnion, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, onValue, onDisconnect, set, serverTimestamp as dbServerTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// DOM
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
const typingIndicator = document.getElementById('typing-indicator');

let currentRoom = '';
let unsubscribe = null;
const userNameCache = new Map();

// sanitize
function sanitizeInput(text){ const div=document.createElement('div'); div.textContent=text; return div.innerHTML; }

// get user name
async function getUserDisplayName(uid){
  if(userNameCache.has(uid)) return userNameCache.get(uid);
  try{ const docSnap=await getDoc(doc(firestore,'users',uid)); const name=docSnap.exists()?docSnap.data().displayName:'未知使用者'; userNameCache.set(uid,name); return name; } catch(e){ console.error('查詢使用者名稱失敗:',uid,e); return '未知使用者'; }
}

// append message
async function appendMessage(msg,uid){
  let timestampDate = msg.timestamp?.toDate?.() || new Date();
  const time = timestampDate.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
  const side = msg.uid===uid?'you':'other';
  let readByText=''; let isReadByMe=false;
  if(msg.readBy?.length>0){ const readNames=await Promise.all(msg.readBy.map(getUserDisplayName)); readByText=`已讀：${readNames.join('、')}`; isReadByMe=msg.readBy.includes(uid);}
  else readByText='無人已讀';
  const row=document.createElement('div'); row.className=`message-row ${side}`; row.setAttribute('data-msg-id',msg.id);
  const avatarText=document.createElement('div'); avatarText.className='avatar-text'; avatarText.textContent=msg.user?.[0]?.toUpperCase()||'?';
  const bubble=document.createElement('div'); bubble.className=`message ${side}`; bubble.setAttribute('aria-label',`${msg.user} 說：${sanitizeInput(msg.text)}，時間：${time}`);
  bubble.setAttribute('data-msg-id',msg.id);
  bubble.innerHTML=`<span class="message-text">${sanitizeInput(msg.text)}</span><span class="message-time">${time}</span><span class="read-status" data-msg-id="${msg.id}" title="${readByText}">${isReadByMe?'✔':''}</span>`;
  side==='you'? (row.appendChild(bubble),row.appendChild(avatarText)) : (row.appendChild(avatarText),row.appendChild(bubble));
  chatBox.appendChild(row); chatBox.scrollTop=chatBox.scrollHeight;
}

// mark message as read
async function markMessageAsRead(msgId,uid){ try{ const msgRef=doc(firestore,'rooms',currentRoom,'messages',msgId); await updateDoc(msgRef,{readBy:arrayUnion(uid)});}catch(e){console.error(`標記訊息 ${msgId} 已讀失敗:`,e);}}

// login/logout
loginBtn.onclick=async()=>{ try{ await signInWithPopup(auth,provider);}catch(e){console.error('登入失敗:',e); alert(`登入失敗：${e.message}`);} };
logoutBtn.onclick=async()=>{ try{ await signOut(auth);}catch(e){console.error('登出失敗:',e); alert('無法登出，請稍後重試');} };

// auth state
onAuthStateChanged(auth,user=>{
  if(user){
    userInfo.textContent=`👋 ${user.displayName}`;
    loginCard.style.display='none'; chatSection.style.display='flex'; logoutBtn.style.display='inline-block'; loginBtn.style.display='none';
    setDoc(doc(firestore,'users',user.uid),{displayName:user.displayName||'匿名使用者'},{merge:true});
    setupPresence(user); watchPresence(); watchRoomList();
  } else {
    userInfo.textContent=''; loginCard.style.display='block'; chatSection.style.display='none'; logout