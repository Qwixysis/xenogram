import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot, 
  collection, addDoc, serverTimestamp, query, orderBy, setDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// ========== Глобальные переменные ==========
let currentUser = null;
let currentChatUid = null;           
let unsubscribeChat = null;
let unsubscribeFriends = null;
let unsubscribePending = null;
let unsubscribeTyping = null;
let typingTimeout = null;

let replyToMsgId = null;
let contextMenuTargetMsgId = null;
let contextMenuTargetFriendUid = null;
let editingMsgId = null;

let userSettings = { hideOnline: false, friendsOnly: false, sound: true };
let activeTypingListeners = {}; // Moved to GLOBAL top level for safety

// ========== Effect System (Particles) ==========
const canvas = document.getElementById('effectsCanvas');
const ctx = canvas?.getContext('2d');
let particles = [];

function resizeCanvas() {
    if(canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
    constructor(x, y, color, type = 'square') {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 8 + 4;
        this.speedX = Math.random() * 6 - 3;
        this.speedY = Math.random() * -10 - 2;
        this.gravity = 0.2;
        this.color = color;
        this.rotation = Math.random() * 360;
        this.rotationSpeed = Math.random() * 10 - 5;
        this.opacity = 1;
        this.type = type;
    }
    update() {
        this.speedY += this.gravity;
        this.x += this.speedX;
        this.y += this.speedY;
        this.rotation += this.rotationSpeed;
        this.opacity -= 0.01;
    }
    draw() {
        if(!ctx) return;
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation * Math.PI / 180);
        ctx.fillStyle = this.color;
        if(this.type === 'heart') {
            ctx.font = `${this.size * 2}px serif`;
            ctx.fillText('❤️', 0, 0);
        } else {
            ctx.fillRect(-this.size/2, -this.size/2, this.size, this.size);
        }
        ctx.restore();
    }
}

function spawnBurst(x, y, color, count = 30, type = 'square') {
    for(let i=0; i<count; i++) {
        particles.push(new Particle(x, y, color, type));
    }
}

function animateParticles() {
    if(!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for(let i = 0; i < particles.length; i++) {
        particles[i].update();
        particles[i].draw();
        if(particles[i].opacity <= 0) {
            particles.splice(i, 1);
            i--;
        }
    }
    requestAnimationFrame(animateParticles);
}
animateParticles();

window.triggerConfetti = (type = 'default') => {
    const colors = ['#6c5ce7', '#a29bfe', '#00d2d3', '#ff7675', '#feca57'];
    const x = window.innerWidth / 2;
    const y = window.innerHeight + 10;
    if(type === 'love') {
        spawnBurst(x, y, '#ff7675', 40, 'heart');
    } else {
        for(let i=0; i<5; i++) {
            setTimeout(() => {
                const randomX = Math.random() * window.innerWidth;
                spawnBurst(randomX, y, colors[Math.floor(Math.random()*colors.length)], 20);
            }, i * 200);
        }
    }
};

// ========== Emoji Check Utility ==========
function isOnlyEmojis(str) {
    const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
    const match = str.match(emojiRegex);
    if (!match) return false;
    const remaining = str.replace(emojiRegex, '').trim();
    return remaining.length === 0 && match.length <= 3;
}

function renderMessageHTML(msgId, msg, isOutgoing, senderNick, senderPhoto, friendNick, friendPhoto) {
    const senderPhotoFinal = isOutgoing ? (currentUser.photoURL || "") : (friendPhoto || "");
    const senderNickFinal = msg.senderNick || (isOutgoing ? currentUser.displayName : (friendNick || "Друг"));

    let replyHtml = "";
    if(msg.replyTo) {
        replyHtml = `<div class="message-reply-preview">${msg.replyTo}</div>`;
    }

    let content = "";
    if (msg.text) {
        content = msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    } else if (msg.mediaUrl) {
        if (msg.mediaType === "image") {
            content = `<img src="${msg.mediaUrl}" alt="image" loading="lazy">`;
        } else if (msg.mediaType === "video") {
            content = `<video src="${msg.mediaUrl}" controls></video>`;
        } else if (msg.mediaType === "voice") {
            content = `<audio src="${msg.mediaUrl}" controls style="height:35px;"></audio>`;
        }
    }

    let time = "";
    if (msg.timestamp) {
        time = msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (msg.editedAt) {
        time += ` <span style="margin-left:4px;" title="Изменено">(ред.)</span>`;
    }

    let jumboClass = (msg.text && isOnlyEmojis(msg.text)) ? "jumbo-ji" : "";

    let reactionsHtml = "";
    if (msg.reactions) {
        reactionsHtml = '<div class="message-reactions">';
        for (const [emoji, uids] of Object.entries(msg.reactions)) {
            if (uids && uids.length > 0) {
                const isMine = (currentUser && uids.includes(currentUser.uid));
                reactionsHtml += `
                    <div class="reaction-badge ${isMine ? 'mine' : ''}" onclick="toggleReaction('${msgId}', '${emoji}')">
                        ${emoji} <span>${uids.length}</span>
                    </div>
                `;
            }
        }
        reactionsHtml += '</div>';
    }

    return {
        class: `message ${isOutgoing ? "outgoing" : "incoming"} ${jumboClass}`,
        html: `
            ${replyHtml}
            <div class="sender">
              ${senderPhotoFinal ? `<img src="${senderPhotoFinal}">` : ""}
              ${senderNickFinal}
            </div>
            ${content}
            ${reactionsHtml}
            <span class="timestamp">${time} <span class="checkmarks"><svg class="check-icon read" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"></path></svg></span></span>
            <div style="clear:both;"></div>
        `
    };
}

// ========== Toast Notifications ==========
window.showToast = function(message, type = "info") {
    let container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
        toast.classList.remove("show");
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), 400);
    }, 3000);
};

// ========== Инициализация ==========
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  
  // Инициализация UI профиля
  const userNickEl = document.getElementById("userNick");
  const userUidEl = document.getElementById("userUid");
  const userAvatarEl = document.getElementById("userAvatar");
  const userStatusEl = document.getElementById("userCustomStatus");
  
  if(userNickEl) userNickEl.textContent = user.displayName || user.email;
  if(userUidEl) userUidEl.textContent = user.uid;
  if(userAvatarEl) {
      if(user.photoURL) {
          userAvatarEl.innerHTML = `<img src="${user.photoURL}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
      } else {
          userAvatarEl.textContent = (user.displayName?.[0] || user.email?.[0] || "?").toUpperCase();
      }
  }

  // Загружаем Custom Status и Настройки
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if(userDoc.exists()) {
      const data = userDoc.data();
      if(data.settings) {
          userSettings = { ...userSettings, ...data.settings };
      }
      if(userStatusEl) {
          if(data.customStatus) {
              userStatusEl.textContent = data.customStatus;
          } else {
              userStatusEl.textContent = "Установить статус";
          }
      }
  }

  // Загружаем списки
  loadFriends();
  loadPending();

  if (Notification && Notification.permission === "default") {
      Notification.requestPermission();
  }

  // Обновление онлайна
  await setUserOnline(true);
  
  document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === 'visible') {
          setUserOnline(true);
      } else {
          setUserOnline(false);
      }
  });

  setInterval(() => {
      if (document.visibilityState === 'visible') {
          setUserOnline(true);
      }
  }, 120000);
  
  window.addEventListener("beforeunload", () => setUserOnline(false));
  
  // Добавляем логику поиска контактов
  const searchInput = document.getElementById("contactSearch");
  if(searchInput) {
      searchInput.addEventListener("input", (e) => {
          const val = e.target.value.toLowerCase();
          document.querySelectorAll("#friendsList li").forEach(li => {
              const name = li.querySelector(".name-tag").textContent.toLowerCase();
              if(name.includes(val)) li.style.display = "flex";
              else li.style.display = "none";
          });
      });
  }

  // Добавляем обработчик Enter для чата
  const chatInput = document.getElementById("chatInput");
  const charCounter = document.getElementById("charCounter");
  if(chatInput) {
      chatInput.addEventListener('keypress', function (e) {
          if (e.key === 'Enter') {
              window.sendMessage();
          }
      });
      // Обработка статуса "печатает" + лимит символов
      chatInput.addEventListener('input', (e) => {
          handleTyping();
          const len = chatInput.value.length;
          const limit = 250;
          
          if (len > limit) {
              chatInput.value = chatInput.value.substring(0, limit);
          }
          
          if (len > 150) {
              charCounter.style.opacity = "1";
              charCounter.textContent = `${limit - chatInput.value.length}`;
              if (limit - chatInput.value.length < 20) {
                  charCounter.style.color = "#ff7675";
              } else {
                  charCounter.style.color = "var(--accent)";
              }
          } else {
              charCounter.style.opacity = "0";
          }
      });
  }

  // Закрытие контекстного меню при клике в любое место
  document.addEventListener('click', (e) => {
      if(!e.target.closest('.message') && !e.target.closest('#messageContextMenu')) {
          const mMenu = document.getElementById('messageContextMenu');
          if(mMenu) mMenu.style.display = 'none';
      }
      if(!e.target.closest('#friendContextMenu')) {
          const fMenu = document.getElementById('friendContextMenu');
          if(fMenu) fMenu.style.display = 'none';
      }
  });
});

async function setUserOnline(isOnline) {
  if (!currentUser) return;
  try {
      if (userSettings.hideOnline && isOnline) isOnline = false;
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, {
        online: isOnline,
        lastSeen: serverTimestamp()
      });
  } catch(e) {
      console.log("Could not update presence: ", e);
  }
}

// ========== Загрузка друзей и запросов ==========
// activeTypingListeners is now at the top of the file

async function loadFriends() {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  
  unsubscribeFriends = onSnapshot(userRef, async (snap) => {
    const data = snap.data();
    if (!data) return;
    const friendsUids = data.friends || [];
    const friendsList = document.getElementById("friendsList");
    
    // Include current chat if it's not in friends (support for messaging non-friends)
    let displayUids = [...friendsUids];
    if (currentChatUid && !displayUids.includes(currentChatUid)) {
        displayUids.unshift(currentChatUid);
    }
    
    document.getElementById("statFriends").textContent = friendsUids.length;
    document.getElementById("contactsCount").textContent = friendsUids.length;

    if (displayUids.length === 0) {
        friendsList.innerHTML = `<li style="pointer-events:none; opacity:0.5; font-size:0.85em; display:flex; justify-content:center;">У вас пока нет контактов</li>`;
        return;
    }
    
    // Fetch all display uids data in parallel
    const contactDataList = await Promise.all(
        displayUids.map(async (uid) => {
            const fSnap = await getDoc(doc(db, "users", uid));
            return fSnap.exists() ? { uid, ...fSnap.data() } : { uid, nick: "Неизвестный" };
        })
    );

    // Clear and build the list once ready
    friendsList.innerHTML = "";
    let onlineCount = 0;

    contactDataList.forEach((friend) => {
      if (friend.online && friendsUids.includes(friend.uid)) onlineCount++;
      const friendUid = friend.uid;

      const li = document.createElement("li");
      li.setAttribute("data-uid", friendUid);
      li.onclick = () => openChat(friendUid, friend.nick, friend.photoURL, friend.online, friend.customStatus);
      li.oncontextmenu = (e) => {
          e.preventDefault();
          contextMenuTargetFriendUid = friendUid;
          const menu = document.getElementById("friendContextMenu");
          if(menu) {
              menu.style.display = "block";
              let x = e.pageX; let y = e.pageY;
              if(x + menu.offsetWidth > window.innerWidth) x = window.innerWidth - menu.offsetWidth - 10;
              if(y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight - 10;
              menu.style.left = `${x}px`; menu.style.top = `${y}px`;
          }
      };

      if (currentChatUid === friendUid) {
          li.classList.add("active");
          const statusEl = document.getElementById("chatHeaderStatus");
          if(statusEl) statusEl.textContent = friend.online ? "в сети" : "был(а) недавно";
      }

      const avatarContent = friend.photoURL 
        ? `<img src="${friend.photoURL}">`
        : `${(friend.nick?.[0] || "?").toUpperCase()}`;

      const statusClass = friend.online ? "online-indicator" : "offline-indicator";
      const customStatus = friend.customStatus ? `<div style="font-size:0.7rem; color:var(--text-muted);">${friend.customStatus}</div>` : '';
      
      li.innerHTML = `
        <div class="avatar">${avatarContent}</div>
        <div style="flex:1;">
            <div class="name-tag" style="font-weight: 500;">${friend.nick || friendUid}</div>
            <div class="friend-subtext">${friend.online ? 'в сети' : 'был(а) недавно'}</div>
            ${customStatus}
        </div>
        <span class="status-dot ${statusClass}"></span>
      `;
      friendsList.appendChild(li);

      // Listen for typing if not already listening
      const chatId = [currentUser.uid, friendUid].sort().join("_");
      // Clean up old listener if any (actually snapshots handle themselves but for safety)
      if (activeTypingListeners[friendUid]) activeTypingListeners[friendUid]();

      activeTypingListeners[friendUid] = onSnapshot(doc(db, "privateMessages", chatId), (chatSnap) => {
          const chatMeta = chatSnap.data();
          const targetLi = document.querySelector(`#friendsList li[data-uid="${friendUid}"]`);
          if(!targetLi) return;
          const subtext = targetLi.querySelector('.friend-subtext');
          if (chatMeta && chatMeta.typing && chatMeta.typing[friendUid]) {
              subtext.innerHTML = '<span class="typing-status">печатает...</span>';
              subtext.style.color = 'var(--accent-light)';
          } else {
              subtext.innerHTML = friend.online ? 'в сети' : 'был(а) недавно';
              subtext.style.color = 'var(--text-muted)';
          }
      });
    });
    
    document.getElementById("statOnline").textContent = onlineCount;
  });
}

function loadPending() {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  unsubscribePending = onSnapshot(userRef, (snap) => {
    const data = snap.data();
    if (!data) return;
    const pendingUids = data.pending || [];
    const pendingList = document.getElementById("pendingList");
    const pendingHeader = document.getElementById("pendingHeader");
    
    if(pendingList) pendingList.innerHTML = "";

    if(pendingUids.length === 0 && pendingList) {
        if(pendingHeader) pendingHeader.style.display = "none";
        return;
    } else {
        if(pendingHeader) pendingHeader.style.display = "block";
    }

    pendingUids.forEach(async (uid) => {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) return;
      const userData = userSnap.data();
      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.alignItems = "center";
      li.style.cursor = "default";
      li.style.background = "rgba(255,255,255,0.05)";

      li.innerHTML = `
        <span style="font-size:0.9em;">${userData.nick || uid}</span>
        <button onclick="acceptFriendRequest('${uid}')" class="btn-small" style="background:var(--accent); color:white; border:none; cursor:pointer;" title="Принять">Принять</button>
      `;
      pendingList.appendChild(li);
    });
  });
}

window.acceptFriendRequest = async (friendUid) => {
  if (!currentUser) return;
  const myUid = currentUser.uid;

  try {
      await updateDoc(doc(db, "users", myUid), {
        friends: arrayUnion(friendUid),
        pending: arrayRemove(friendUid)
      });
      await updateDoc(doc(db, "users", friendUid), {
        friends: arrayUnion(myUid),
        requestsSent: arrayRemove(myUid)
      });
      showToast("Контакт добавлен!", "success");
      
      const friendSnap = await getDoc(doc(db, "users", friendUid));
      if (friendSnap.exists()) {
        const friend = friendSnap.data();
        openChat(friendUid, friend.nick, friend.photoURL, friend.online, friend.customStatus);
      }
  } catch(e) {
      showToast("Ошибка при добавлении", "error");
  }
};

// ========== Открыть чат ==========

// ========== Открыть чат ==========
window.openChat = async function(friendUid, friendNick, friendPhoto, friendOnline, friendCustomStatus) {
  document.querySelectorAll("#friendsList li").forEach(el => el.classList.remove("active"));
  const friendLi = document.querySelector(`#friendsList li[data-uid="${friendUid}"]`);
  if (friendLi) friendLi.classList.add("active");
  
  // Mobile: Switch to chat view
  document.body.classList.add("show-chat");

  currentChatUid = friendUid;
  replyToMsgId = null;
  cancelReply();
  cancelEdit();

  const headerAvatar = document.getElementById("chatHeaderAvatar");
  const headerName = document.getElementById("chatHeaderName");
  const headerStatus = document.getElementById("chatHeaderStatus");
  
  if(friendPhoto) {
      headerAvatar.innerHTML = `<img src="${friendPhoto}" style="width:100%; height:100%; object-fit:cover; border-radius:10px;">`;
  } else {
      headerAvatar.innerHTML = (friendNick?.[0] || "?").toUpperCase();
  }
  
  headerName.textContent = friendNick || friendUid;
  let statusText = friendOnline ? "в сети" : "был(а) недавно";
  if(friendCustomStatus) statusText += ` • ${friendCustomStatus}`;
  headerStatus.textContent = statusText;
  
  document.getElementById("chatHeader").style.display = "flex";
  document.getElementById("messageInputArea").style.display = "flex";
  
  const chatInput = document.getElementById("chatInput");
  chatInput.value = "";
  chatInput.focus();

  if (unsubscribeChat) unsubscribeChat();
  if (unsubscribeTyping) unsubscribeTyping();

  const chatId = [currentUser.uid, friendUid].sort().join("_");
  const messagesRef = collection(db, "privateMessages", chatId, "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscribeChat = onSnapshot(q, (snapshot) => {
    const chatBox = document.getElementById("chatBox");
    
    if (snapshot.empty) {
        chatBox.innerHTML = `
            <div class="empty-chat" style="height:100%; margin-top:50px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:60px; height:60px; margin-bottom:15px; opacity:0.5;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <h2>Здесь пока пусто</h2>
                <p style="font-size:0.9em; opacity:0.7; margin-top:10px;">Напишите первое сообщение</p>
            </div>
        `;
        return;
    } else {
        const emptyState = chatBox.querySelector('.empty-chat');
        if(emptyState) emptyState.remove();
    }

    let isAtBottom = (chatBox.scrollHeight - chatBox.scrollTop <= chatBox.clientHeight + 150);

    snapshot.docChanges().forEach((change) => {
      const docSnap = change.doc;
      const msg = docSnap.data();
      const msgId = docSnap.id;

      if (change.type === "added") {
          const isOutgoing = msg.senderUid === currentUser.uid;
          const msgDiv = document.createElement("div");
          msgDiv.id = `msg_${msgId}`;
          const rendered = renderMessageHTML(msgId, msg, isOutgoing, friendNick, friendPhoto);
          msgDiv.className = rendered.class;
          msgDiv.innerHTML = rendered.html;
          msgDiv.oncontextmenu = (e) => {
              e.preventDefault();
              showContextMenu(e, msgId, isOutgoing, msg.text || "Медиа");
          };
          chatBox.appendChild(msgDiv);
      } 
      if (change.type === "removed") {
          const el = document.getElementById(`msg_${msgId}`);
          if(el) el.remove();
      }
      if (change.type === "modified") {
          const el = document.getElementById(`msg_${msgId}`);
          if (el) {
              const isOutgoing = msg.senderUid === currentUser.uid;
              const rendered = renderMessageHTML(msgId, msg, isOutgoing, friendNick, friendPhoto);
              el.className = rendered.class;
              el.innerHTML = rendered.html;
              el.oncontextmenu = (e) => {
                  e.preventDefault();
                  showContextMenu(e, msgId, isOutgoing, msg.text || "Медиа");
              };
          }
      }
    });

    if (isAtBottom) {
        chatBox.scrollTo({top: chatBox.scrollHeight, behavior: 'smooth'});
    }
  });

  const chatMetaRef = doc(db, "privateMessages", chatId);
  unsubscribeTyping = onSnapshot(chatMetaRef, (snap) => {
      const data = snap.data();
      const indicator = document.getElementById("typingIndicatorContainer");
      if (data && data.typing && data.typing[friendUid]) {
          indicator.style.display = "block";
          const chatBox = document.getElementById("chatBox");
          chatBox.scrollTo({top: chatBox.scrollHeight, behavior: 'smooth'});
      } else {
          indicator.style.display = "none";
      }
  });
};

window.closeChat = () => {
    document.body.classList.remove("show-chat");
    // Optionally deselect friend in list for mobile
    document.querySelectorAll("#friendsList li").forEach(el => el.classList.remove("active"));
};

function showContextMenu(e, msgId, isOutgoing, msgText) {
    contextMenuTargetMsgId = {id: msgId, text: msgText, isOutgoing};
    const menu = document.getElementById("messageContextMenu");
    
    // Настраиваем видимость кнопки удаления и изменения (Только свои сообщения)
    const delBtn = document.getElementById('menuDelete');
    const editBtn = document.getElementById('menuEdit');
    if(!isOutgoing) {
        delBtn.style.display = 'none';
        if(editBtn) editBtn.style.display = 'none';
    } else {
        delBtn.style.display = 'block';
        if(editBtn) editBtn.style.display = 'block';
        // Hide edit for media
        if(editBtn && !msgText) editBtn.style.display = 'none';
    }

    menu.style.display = "block";
    
    // Позиционируем
    let x = e.pageX;
    let y = e.pageY;
    if(x + menu.offsetWidth > window.innerWidth) x = window.innerWidth - menu.offsetWidth - 10;
    if(y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight - 10;
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
}

window.triggerReply = () => {
    if(!contextMenuTargetMsgId) return;
    replyToMsgId = contextMenuTargetMsgId;
    
    let container = document.getElementById('replyingToBanner');
    if(!container) {
        container = document.createElement('div');
        container.id = 'replyingToBanner';
        container.className = 'replying-to-banner';
        const inputArea = document.getElementById('messageInputArea');
        inputArea.parentNode.insertBefore(container, inputArea);
    }
    
    container.innerHTML = `
        <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px; vertical-align:middle;"><polyline points="15 10 20 15 15 20"></polyline><path d="M4 4v7a4 4 0 0 0 4 4h12"></path></svg>
            Ответ: <span style="color:var(--text);">${replyToMsgId.text.substring(0,30)}${replyToMsgId.text.length>30?'...':''}</span>
        </div>
        <div class="cancel" onclick="cancelReply()">&times;</div>
    `;
    
    document.getElementById('messageContextMenu').style.display = 'none';
    document.getElementById('chatInput').focus();
};

window.triggerEditMessage = () => {
    if(!contextMenuTargetMsgId) return;
    document.getElementById('messageContextMenu').style.display = 'none';
    editingMsgId = contextMenuTargetMsgId.id;
    const input = document.getElementById("chatInput");
    
    cancelReply();
    
    let container = document.getElementById('replyingToBanner');
    if(!container) {
        container = document.createElement('div');
        container.id = 'replyingToBanner';
        container.className = 'replying-to-banner';
        const inputArea = document.getElementById('messageInputArea');
        inputArea.parentNode.insertBefore(container, inputArea);
    }
    
    container.innerHTML = `
        <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px; vertical-align:middle;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Редактирование: <span style="color:var(--text);">${contextMenuTargetMsgId.text.substring(0,30)}...</span>
        </div>
        <div class="cancel" onclick="cancelEdit()">&times;</div>
    `;
    
    input.value = contextMenuTargetMsgId.text.replace(/<br>/g, "\n");
    input.focus();
};

window.cancelEdit = () => {
    if(!editingMsgId) return;
    editingMsgId = null;
    const banner = document.getElementById('replyingToBanner');
    if(banner) banner.remove();
    document.getElementById("chatInput").value = "";
}

window.cancelReply = () => {
    replyToMsgId = null;
    const banner = document.getElementById('replyingToBanner');
    if(banner) banner.remove();
}

window.triggerDelete = async () => {
    if(!contextMenuTargetMsgId || !currentChatUid || !currentUser) return;
    document.getElementById('messageContextMenu').style.display = 'none';
    
    const chatId = [currentUser.uid, currentChatUid].sort().join("_");
    try {
        await deleteDoc(doc(db, "privateMessages", chatId, "messages", contextMenuTargetMsgId.id));
        showToast("Сообщение удалено");
    } catch(e) {
        showToast("Ошибка удаления", "error");
    }
};

window.triggerDeleteFriend = async () => {
    if(!contextMenuTargetFriendUid || !currentUser) return;
    document.getElementById('friendContextMenu').style.display = 'none';
    const fUid = contextMenuTargetFriendUid;
    
    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            friends: arrayRemove(fUid)
        });
        await updateDoc(doc(db, "users", fUid), {
            friends: arrayRemove(currentUser.uid)
        });
        showToast("Контакт удален");
        
        if (currentChatUid === fUid) {
            document.getElementById("chatHeader").style.display = "none";
            document.getElementById("messageInputArea").style.display = "none";
            document.getElementById("chatBox").innerHTML = `
                <div class="empty-chat no-contacts-yet">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    <h2>Выберите контакт</h2>
                </div>
            `;
            currentChatUid = null;
        }
    } catch(e) {
        showToast("Ошибка при удалении контакта", "error");
    }
};

// ========== Typing Logic ==========
async function handleTyping() {
    if (!currentChatUid || !currentUser) return;
    const chatId = [currentUser.uid, currentChatUid].sort().join("_");
    const chatMetaRef = doc(db, "privateMessages", chatId);
    
    await setDoc(chatMetaRef, { typing: { [currentUser.uid]: true } }, { merge: true });
    
    if (typingTimeout) clearTimeout(typingTimeout);
    
    typingTimeout = setTimeout(async () => {
        await setDoc(chatMetaRef, { typing: { [currentUser.uid]: false } }, { merge: true });
    }, 2000);
}

// ========== Chat Header Tools ==========
window.toggleChatSearch = () => {
    const box = document.getElementById("chatSearchBox");
    const input = document.getElementById("chatSearchInput");
    if(box.style.display === "none") {
        box.style.display = "block";
        input.value = "";
        input.focus();
    } else {
        box.style.display = "none";
        // Reset search
        document.querySelectorAll("#chatBox .message").forEach(msg => {
            msg.style.display = "block";
        });
    }
};

window.showChatInfo = () => {
    if(!currentChatUid) return;
    const name = document.getElementById("chatHeaderName").textContent;
    showToast(`Чат с: ${name}\nUID: ${currentChatUid}`, "info");
};

const chatSearchInput = document.getElementById("chatSearchInput");
if(chatSearchInput) {
    chatSearchInput.addEventListener("input", (e) => {
        const val = e.target.value.toLowerCase();
        document.querySelectorAll("#chatBox .message").forEach(msg => {
            // Find text content inside message but ignore time/buttons
            let text = msg.textContent.replace(msg.querySelector('.timestamp')?.textContent || "", "");
            if(text.toLowerCase().includes(val)) {
                msg.style.display = "block";
            } else {
                msg.style.display = "none";
            }
        });
    });
}

// ========== Отправка текстового сообщения ==========
window.sendMessage = async () => {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || !currentChatUid || !currentUser) return;
  
  const sendBtn = document.getElementById("sendBtn");
  sendBtn.style.opacity = "0.5";
  sendBtn.style.pointerEvents = "none";

  try {
      // Check privacy settings
      if (!editingMsgId) {
          const recipientDoc = await getDoc(doc(db, "users", currentChatUid));
          if (recipientDoc.exists()) {
              const rData = recipientDoc.data();
              if (rData.settings && rData.settings.friendsOnly) {
                  if (!rData.friends || !rData.friends.includes(currentUser.uid)) {
                      showToast("Пользователь принимает сообщения только от друзей", "error");
                      sendBtn.style.opacity = "1";
                      sendBtn.style.pointerEvents = "all";
                      return;
                  }
              }
          }
      }

      const chatId = [currentUser.uid, currentChatUid].sort().join("_");
      
      if (typingTimeout) clearTimeout(typingTimeout);
      const chatMetaRef = doc(db, "privateMessages", chatId);
      await setDoc(chatMetaRef, { typing: { [currentUser.uid]: false } }, { merge: true });

      let msgData = {
        senderUid: currentUser.uid,
        senderNick: currentUser.displayName || currentUser.email,
        text: text,
        timestamp: serverTimestamp()
      };

      if (editingMsgId) {
          await updateDoc(doc(db, "privateMessages", chatId, "messages", editingMsgId), {
              text: text,
              editedAt: serverTimestamp()
          });
          cancelEdit();
      } else {
          if(replyToMsgId) {
              msgData.replyTo = replyToMsgId.text;
              cancelReply();
          }
          await addDoc(collection(db, "privateMessages", chatId, "messages"), msgData);
      }
      
      input.value = "";
      const charCounter = document.getElementById("charCounter");
      if (charCounter) charCounter.style.opacity = "0";
      
      const chatBox = document.getElementById("chatBox");
      chatBox.scrollTo({top: chatBox.scrollHeight, behavior: 'smooth'});

      // Effects triggers
      const lower = text.toLowerCase();
      if(lower.includes("ура") || lower.includes("поздравляю") || lower.includes("party") || lower.includes("супер")) {
          window.triggerConfetti();
      } else if(lower.includes("❤️") || lower.includes("люблю") || lower.includes("love")) {
          window.triggerConfetti('love');
      }

  } catch(e) {
      showToast("Ошибка при отправке", "error");
  } finally {
      sendBtn.style.opacity = "1";
      sendBtn.style.pointerEvents = "all";
      input.focus();
  }
};

// ========== Запись Голосовых сообщений ==========
function blobToBase64(blob) {
  return new Promise((resolve, _) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

let mediaRecorder = null;
let audioChunks = [];
let recordingTimeout = null;

const voiceBtn = document.getElementById("voiceBtn");
if(voiceBtn) {
    let isRecording = false;

    const startRecording = async () => {
        if (!currentChatUid || !currentUser) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = e => { if(e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const base64Audio = await blobToBase64(audioBlob);
                
                const chatId = [currentUser.uid, currentChatUid].sort().join("_");
                await addDoc(collection(db, "privateMessages", chatId, "messages"), {
                    senderUid: currentUser.uid,
                    senderNick: currentUser.displayName || currentUser.email,
                    mediaUrl: base64Audio,
                    mediaType: "voice",
                    timestamp: serverTimestamp()
                });
                showToast("Голосовое отправлено!", "success");
            };

            mediaRecorder.start();
            isRecording = true;
            voiceBtn.classList.add("recording");
            
            // Limit to 15 seconds
            recordingTimeout = setTimeout(() => {
                if(isRecording) stopRecording();
            }, 15000);

        } catch(err) {
            showToast("Нет доступа к микрофону", "error");
        }
    };

    const stopRecording = () => {
        if(isRecording && mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
            isRecording = false;
            voiceBtn.classList.remove("recording");
            if(recordingTimeout) clearTimeout(recordingTimeout);
            
            // Stop mic completely
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
    };

    voiceBtn.addEventListener('mousedown', startRecording);
    voiceBtn.addEventListener('mouseup', stopRecording);
    voiceBtn.addEventListener('mouseleave', stopRecording);
    voiceBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
    voiceBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });
    voiceBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); stopRecording(); });
}

// ========== Настройки (Профиль) ==========
window.openSettingsModal = async () => {
  if (!currentUser) return;
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));
  if (userSnap.exists()) {
    const data = userSnap.data();
    document.getElementById("profileUid").textContent = data.uid || currentUser.uid;
    document.getElementById("profileEmail").textContent = data.email || currentUser.email;
    document.getElementById("profileNick").textContent = data.nick || currentUser.displayName;
    document.getElementById("profileCustomStatus").textContent = data.customStatus || "Статус не установлен";
    
    // Предзаполнение инпутов
    document.getElementById("newNick").value = data.nick || currentUser.displayName || "";
    document.getElementById("newStatus").value = data.customStatus || "";
    document.getElementById("newPhoto").value = data.photoURL || "";
    
    const imgEl = document.getElementById("profileAvatarImg");
    const textEl = document.getElementById("profileAvatarText");
    if(data.photoURL) {
        imgEl.src = data.photoURL;
        imgEl.style.display = "block";
        textEl.style.display = "none";
    } else {
        imgEl.style.display = "none";
        textEl.style.display = "block";
        textEl.textContent = (data.nick?.[0] || "?").toUpperCase();
    }
    
    if(data.settings) {
        userSettings = { ...userSettings, ...data.settings };
    }
    document.getElementById("settingHideOnline").checked = userSettings.hideOnline;
    document.getElementById("settingFriendsOnly").checked = userSettings.friendsOnly;
    document.getElementById("settingSound").checked = userSettings.sound;
  }
  document.getElementById("settingsModal").style.display = "flex";
};

window.closeSettingsModal = () => {
  document.getElementById("settingsModal").style.display = "none";
};

window.switchSettingsTab = (tabName) => {
    // Hide all tabs
    document.querySelectorAll(".settings-tab").forEach(tab => {
        tab.style.display = "none";
    });
    // Show selected tab
    document.getElementById(`tab-${tabName}`).style.display = "block";
    
    // Update active class in sidebar
    document.querySelectorAll(".settings-sidebar li").forEach(li => {
        li.classList.remove("active");
    });
    const activeLi = document.querySelector(`.settings-sidebar li[onclick*="${tabName}"]`);
    if(activeLi) activeLi.classList.add("active");

    // Update mobile title
    const titles = {
        'account': 'Учетная запись',
        'appearance': 'Внешний вид',
        'privacy': 'Конфиденциальность',
        'notifications': 'Уведомления'
    };
    const mobTitle = document.getElementById("mobileSettingsTitle");
    if(mobTitle) mobTitle.textContent = titles[tabName] || "Настройки";
};

window.updateProfileData = async () => {
  const newNick = document.getElementById("newNick").value.trim();
  const newStatus = document.getElementById("newStatus").value.trim();
  const newPhoto = document.getElementById("newPhoto").value.trim();

  const updates = {};
  if (newNick) updates.nick = newNick;
  if (newStatus !== undefined) updates.customStatus = newStatus; // Can clear it
  if (newPhoto !== undefined) updates.photoURL = newPhoto;

  try {
      await updateDoc(doc(db, "users", currentUser.uid), updates);
      if (newNick) {
        await updateProfile(currentUser, { displayName: newNick });
      }
      if (newPhoto) {
        await updateProfile(currentUser, { photoURL: newPhoto });
      }

      showToast("Настройки сохранены!", "success");
      
      const userNickEl = document.getElementById("userNick");
      if(userNickEl && newNick) userNickEl.textContent = newNick;
      
      const userStatusEl = document.getElementById("userCustomStatus");
      if(userStatusEl) userStatusEl.textContent = newStatus || "Установить статус";

      const userAvatarEl = document.getElementById("userAvatar");
      if (newPhoto && userAvatarEl) {
          userAvatarEl.innerHTML = `<img src="${newPhoto}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
      } else if (newNick && userAvatarEl && !newPhoto) {
          userAvatarEl.textContent = newNick[0].toUpperCase();
      }
      
  } catch(e) {
      showToast("Ошибка при сохранении", "error");
  }
};

window.updateSettings = async (key, value) => {
    userSettings[key] = value;
    try {
        await setDoc(doc(db, "users", currentUser.uid), { settings: userSettings }, { merge: true });
        if (key === 'hideOnline') {
            setUserOnline(!value);
        }
    } catch(e) {
        console.error("Error updating settings:", e);
        window.showToast("Ошибка сохранения настроек", "error");
    }
};

window.triggerReact = async (emoji) => {
    if (!contextMenuTargetMsgId || !currentChatUid || !currentUser) return;
    const msgId = contextMenuTargetMsgId.id;
    document.getElementById('messageContextMenu').style.display = 'none';
    await toggleReaction(msgId, emoji);
};

window.toggleReaction = async (msgId, emoji) => {
    if (!currentChatUid || !currentUser) return;
    const chatId = [currentUser.uid, currentChatUid].sort().join("_");
    const msgRef = doc(db, "privateMessages", chatId, "messages", msgId);
    
    try {
        const snap = await getDoc(msgRef);
        if(!snap.exists()) return;
        const data = snap.data();
        let reactions = data.reactions || {};
        let uids = reactions[emoji] || [];
        
        if (uids.includes(currentUser.uid)) {
            uids = uids.filter(id => id !== currentUser.uid);
        } else {
            uids.push(currentUser.uid);
        }
        
        reactions[emoji] = uids;
        await updateDoc(msgRef, { reactions: reactions });
    } catch(e) {
        showToast("Ошибка при реакции", "error");
    }
};

window.openFriendModal = () => {
  document.getElementById("friendModal").style.display = "block";
};
window.closeFriendModal = () => {
  document.getElementById("friendModal").style.display = "none";
};

window.sendFriendRequest = async () => {
  const friendUid = document.getElementById("friendUidInput").value.trim();
  const errorEl = document.getElementById("friendError");
  if (!friendUid) {
      if (errorEl) errorEl.textContent = "UID не может быть пустым";
      return;
  }

  if (friendUid === currentUser.uid) {
    if (errorEl) errorEl.textContent = "Нельзя добавить самого себя";
    return;
  }

  const friendRef = doc(db, "users", friendUid);
  const friendSnap = await getDoc(friendRef);
  if (!friendSnap.exists()) {
    if (errorEl) errorEl.textContent = "Пользователь с таким UID не найден";
    return;
  }

  try {
      await updateDoc(friendRef, {
        pending: arrayUnion(currentUser.uid)
      });
      await updateDoc(doc(db, "users", currentUser.uid), {
        requestsSent: arrayUnion(friendUid)
      });

      closeFriendModal();
      showToast("Запрос отправлен!", "success");
      document.getElementById("friendUidInput").value = "";
  } catch(e) {
      if (errorEl) errorEl.textContent = "Произошла ошибка при отправке";
  }
};

// ========== Дополнительные инструменты чата ==========
window.toggleChatSearch = () => {
    const box = document.getElementById("chatSearchBox");
    if(!box) return;
    if(box.style.display === "none") {
        box.style.display = "block";
        document.getElementById("chatSearchInput")?.focus();
    } else {
        box.style.display = "none";
    }
};

document.getElementById("chatSearchInput")?.addEventListener("input", (e) => {
    const val = e.target.value.toLowerCase();
    const msgs = document.querySelectorAll("#chatBox .message");
    msgs.forEach(m => {
        if(m.textContent.toLowerCase().includes(val)) {
            m.style.display = "block";
        } else {
            m.style.display = "none";
        }
    });
});

window.showChatInfo = async () => {
    if(!currentChatUid) return;
    const friendSnap = await getDoc(doc(db, "users", currentChatUid));
    if(!friendSnap.exists()) return;
    const friend = friendSnap.data();
    
    let modal = document.getElementById("chatInfoModal");
    if(!modal) {
        modal = document.createElement("div");
        modal.id = "chatInfoModal";
        modal.className = "modal-overlay";
        modal.innerHTML = `
            <div class="modal-content glass" style="max-width: 400px; padding: 30px;">
                <h2 style="margin-bottom: 20px;">Информация о чате</h2>
                <div id="modalFriendInfo" style="display:flex; align-items:center; gap:15px; margin-bottom:25px;"></div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display:block; margin-bottom:10px; font-size:0.9rem; opacity:0.7;">Фон чата</label>
                    <div style="display:flex; gap:10px;">
                        <div onclick="setChatWallpaper('default')" style="width:40px; height:40px; background:rgba(255,255,255,0.1); border:1px solid var(--accent); border-radius:8px; cursor:pointer;" title="Стандартный"></div>
                        <div onclick="setChatWallpaper('dark')" style="width:40px; height:40px; background:#000; border:1px solid #333; border-radius:8px; cursor:pointer;" title="Черный"></div>
                        <div onclick="setChatWallpaper('ocean')" style="width:40px; height:40px; background:linear-gradient(45deg, #0f2027, #203a43, #2c5364); border-radius:8px; cursor:pointer;" title="Океан"></div>
                        <div onclick="setChatWallpaper('sakura')" style="width:40px; height:40px; background:linear-gradient(45deg, #ffc9e0, #ff9a9e); border-radius:8px; cursor:pointer;" title="Сакура"></div>
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button class="btn-danger" style="width:100%; height:45px;" onclick="clearChatHistory()">Очистить историю</button>
                    <button class="btn-secondary" style="width:100%; height:45px;" onclick="document.getElementById('chatInfoModal').style.display='none'">Закрыть</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    const infoArea = document.getElementById("modalFriendInfo");
    if(infoArea) {
        infoArea.innerHTML = `
            <div style="width:60px; height:60px; border-radius:15px; background:var(--bg-tertiary); display:flex; align-items:center; justify-content:center; overflow:hidden;">
                ${friend.photoURL ? `<img src="${friend.photoURL}" style="width:100%; height:100%; object-fit:cover;">` : (friend.nick?.[0] || "?").toUpperCase()}
            </div>
            <div>
                <div style="font-weight:600; font-size:1.2rem;">${friend.nick || "Друг"}</div>
                <div style="font-size:0.8rem; opacity:0.6;">${friend.online ? 'в сети' : 'был(а) недавно'}</div>
            </div>
        `;
    }

    modal.style.display = "flex";
};

window.setChatWallpaper = (type) => {
    const chatBox = document.getElementById("chatBox");
    if(!chatBox) return;
    if(type === 'default') chatBox.style.background = "transparent";
    if(type === 'dark') chatBox.style.background = "#050505";
    if(type === 'ocean') chatBox.style.background = "linear-gradient(45deg, #0f2027, #203a43, #2c5364)";
    if(type === 'sakura') chatBox.style.background = "linear-gradient(45deg, #ffc9e0, #ff9a9e)";
};

window.clearChatHistory = async () => {
    if(!confirm("Вы уверены, что хотите очистить историю?")) return;
    showToast("История очищена", "info");
    document.getElementById("chatBox").innerHTML = "";
    document.getElementById('chatInfoModal').style.display='none';
};

// ========== Выход ==========
window.logout = async () => {
  await setUserOnline(false);
  signOut(auth).then(() => {
    window.location.href = "index.html";
  });
};

// ========== UI Utilities (Theme, Copy, etc.) ==========
window.copyUid = () => {
    const uid = document.getElementById('profileUid')?.textContent;
    if (uid) {
        navigator.clipboard.writeText(uid).then(() => {
            window.showToast("UID скопирован", "success");
        });
    }
};

window.setTheme = (theme) => {
    document.body.className = `app-page theme-${theme}`;
    localStorage.setItem('xenogram_theme', theme);
    
    document.querySelectorAll('.theme-color').forEach(el => el.classList.remove('active'));
    const target = document.querySelector('.theme-color.' + theme);
    if(target) target.classList.add('active');
};

// Theme initialization
(function initTheme() {
    const savedTheme = localStorage.getItem('xenogram_theme') || 'violet';
    document.body.className = `app-page theme-${savedTheme}`;
    // Wait for DOM to sync theme badges if settings open
    setTimeout(() => {
        const target = document.querySelector('.theme-color.' + savedTheme);
        if(target) target.classList.add('active');
    }, 500);
})();
