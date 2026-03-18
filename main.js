import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot, 
  collection, addDoc, serverTimestamp, query, orderBy, setDoc, where, getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// ========== Глобальные переменные ==========
let currentUser = null;
let currentChatUid = null;           
let currentChatNick = '';            
let unsubscribeChat = null;
let unsubscribeFriends = null;
let unsubscribePending = null;

// ========== Инициализация ==========
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  
  // Проверяем, существует ли документ пользователя в Firestore
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  
  let userData = {};
  if (!userSnap.exists()) {
    // Если документа нет – создаём его (для старых пользователей)
    userData = {
      uid: user.uid,
      email: user.email,
      nick: user.displayName || user.email.split('@')[0],
      photoURL: user.photoURL || "",
      friends: [],
      pending: [],
      requestsSent: [],
      online: true,
      lastSeen: serverTimestamp()
    };
    await setDoc(userRef, userData);
  } else {
    userData = userSnap.data();
    // Обновляем онлайн статус
    await updateDoc(userRef, {
      online: true,
      lastSeen: serverTimestamp()
    });
  }
  
  const displayNick = userData.nick || user.email?.split('@')[0] || 'User';
  
  document.getElementById("userNick").textContent = displayNick;
  document.getElementById("userUid").textContent = user.uid;
  
  const avatarDiv = document.getElementById("userAvatar");
  if (userData.photoURL) {
    avatarDiv.innerHTML = `<img src="${userData.photoURL}" style="width:36px; height:36px; border-radius:50%;">`;
  } else {
    avatarDiv.textContent = displayNick[0].toUpperCase();
  }

  // Загружаем список друзей и запросов
  loadFriends();
  loadPending();

  // При закрытии вкладки ставим офлайн
  window.addEventListener("beforeunload", () => {
    if (currentUser) {
      updateDoc(doc(db, "users", currentUser.uid), { online: false });
    }
  });
});

// ========== Загрузка друзей ==========
async function loadFriends() {
  if (!currentUser) return;
  
  const userRef = doc(db, "users", currentUser.uid);
  unsubscribeFriends = onSnapshot(userRef, async (snap) => {
    const data = snap.data();
    if (!data) return;
    
    const friendsUids = data.friends || [];
    const friendsList = document.getElementById("friendsList");
    friendsList.innerHTML = "";

    const friendPromises = friendsUids.map(async (friendUid) => {
      const friendSnap = await getDoc(doc(db, "users", friendUid));
      if (!friendSnap.exists()) return null;
      return { uid: friendUid, ...friendSnap.data() };
    });
    
    const friends = (await Promise.all(friendPromises)).filter(f => f);
    
    friends.forEach(friend => {
      const li = document.createElement("li");
      li.setAttribute("data-uid", friend.uid);
      li.onclick = () => openChat(friend.uid, friend.nick, friend.photoURL);

      const avatar = friend.photoURL 
        ? `<img src="${friend.photoURL}" class="avatar">`
        : `<div class="avatar">${(friend.nick?.[0] || "?").toUpperCase()}</div>`;

      const statusClass = friend.online ? "online-indicator" : "offline-indicator";
      
      li.innerHTML = `
        ${avatar}
        <span>${friend.nick || friend.uid}</span>
        <span class="${statusClass}"></span>
      `;
      friendsList.appendChild(li);
    });
  });
}

// ========== Загрузка входящих запросов ==========
async function loadPending() {
  if (!currentUser) return;
  
  const userRef = doc(db, "users", currentUser.uid);
  unsubscribePending = onSnapshot(userRef, async (snap) => {
    const data = snap.data();
    if (!data) return;
    
    const pendingUids = data.pending || [];
    const pendingList = document.getElementById("pendingList");
    pendingList.innerHTML = "";

    const requestPromises = pendingUids.map(async (uid) => {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) return null;
      return { uid, ...userSnap.data() };
    });
    
    const requests = (await Promise.all(requestPromises)).filter(r => r);
    
    requests.forEach(req => {
      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.alignItems = "center";

      li.innerHTML = `
        <span>${req.nick || req.uid}</span>
        <button onclick="acceptFriendRequest('${req.uid}')" style="background: var(--accent); padding: 4px 12px;">✓</button>
      `;
      pendingList.appendChild(li);
    });
  });
}

// ========== Принять запрос в друзья ==========
window.acceptFriendRequest = async (friendUid) => {
  if (!currentUser) return;
  const myUid = currentUser.uid;

  await updateDoc(doc(db, "users", myUid), {
    friends: arrayUnion(friendUid),
    pending: arrayRemove(friendUid)
  });
  
  await updateDoc(doc(db, "users", friendUid), {
    friends: arrayUnion(myUid),
    requestsSent: arrayRemove(myUid)
  });

  const friendSnap = await getDoc(doc(db, "users", friendUid));
  if (friendSnap.exists()) {
    const friend = friendSnap.data();
    openChat(friendUid, friend.nick, friend.photoURL);
  }
};

// ========== Открыть чат с другом ==========
async function openChat(friendUid, friendNick, friendPhoto) {
  if (!currentUser) return;
  
  currentChatUid = friendUid;
  currentChatNick = friendNick;

  document.getElementById("chatHeader").innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      ${friendPhoto ? `<img src="${friendPhoto}" style="width: 32px; height: 32px; border-radius: 50%;">` : `<div class="avatar">${(friendNick?.[0] || "?").toUpperCase()}</div>`}
      <span>${friendNick || friendUid}</span>
    </div>
  `;
  document.getElementById("messageInputArea").style.display = "flex";

  if (unsubscribeChat) unsubscribeChat();

  const chatId = [currentUser.uid, friendUid].sort().join("_");
  const messagesRef = collection(db, "privateMessages", chatId, "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscribeChat = onSnapshot(q, (snapshot) => {
    const chatBox = document.getElementById("chatBox");
    chatBox.innerHTML = "";
    
    snapshot.forEach((doc) => {
      const msg = doc.data();
      const isOutgoing = msg.senderUid === currentUser.uid;
      
      const senderNick = isOutgoing 
        ? (currentUser.displayName || currentUser.email) 
        : (friendNick || friendUid);

      const msgDiv = document.createElement("div");
      msgDiv.className = `message ${isOutgoing ? "outgoing" : "incoming"}`;

      let content = "";
      if (msg.text) {
        content = msg.text;
      } else if (msg.mediaUrl) {
        if (msg.mediaType === "image") {
          content = `<img src="${msg.mediaUrl}" alt="image" style="max-width: 200px; max-height: 200px;">`;
        } else if (msg.mediaType === "video") {
          content = `<video src="${msg.mediaUrl}" controls style="max-width: 250px;"></video>`;
        }
      }

      const time = msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || "";

      msgDiv.innerHTML = `
        <div class="sender">
          <span>${senderNick}</span>
          <span class="timestamp">${time}</span>
        </div>
        ${content}
      `;
      chatBox.appendChild(msgDiv);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}

// ========== Отправка текстового сообщения ==========
window.sendMessage = async () => {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || !currentChatUid || !currentUser) return;

  const chatId = [currentUser.uid, currentChatUid].sort().join("_");
  await addDoc(collection(db, "privateMessages", chatId, "messages"), {
    senderUid: currentUser.uid,
    senderNick: currentUser.displayName || currentUser.email,
    text: text,
    timestamp: serverTimestamp()
  });
  input.value = "";
};

// ========== Отправка медиа ==========
document.getElementById("mediaInput")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentChatUid || !currentUser) return;

  if (file.size > 5 * 1024 * 1024) {
    alert("Файл слишком большой! Макс 5 MB.");
    return;
  }

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) {
    alert("Можно отправлять только фото или видео.");
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const limitRef = doc(db, "dailyLimits", currentUser.uid + "_" + today);
  const limitSnap = await getDoc(limitRef);
  let limits = { photos: 0, videos: 0 };
  if (limitSnap.exists()) limits = limitSnap.data();

  if (isImage && limits.photos >= 10) {
    alert("Лимит фото на сегодня исчерпан (10 шт).");
    return;
  }
  if (isVideo && limits.videos >= 3) {
    alert("Лимит видео на сегодня исчерпан (3 шт).");
    return;
  }

  const storageRef = ref(storage, `media/${currentUser.uid}/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const chatId = [currentUser.uid, currentChatUid].sort().join("_");
  await addDoc(collection(db, "privateMessages", chatId, "messages"), {
    senderUid: currentUser.uid,
    senderNick: currentUser.displayName || currentUser.email,
    mediaUrl: url,
    mediaType: isImage ? "image" : "video",
    timestamp: serverTimestamp()
  });

  await setDoc(limitRef, {
    photos: isImage ? limits.photos + 1 : limits.photos,
    videos: isVideo ? limits.videos + 1 : limits.videos
  }, { merge: true });

  document.getElementById("mediaInput").value = "";
});

// ========== Добавление друга по нику ==========
window.openFriendModal = () => {
  document.getElementById("friendModal").style.display = "block";
};

window.closeFriendModal = () => {
  document.getElementById("friendModal").style.display = "none";
  document.getElementById("friendError").textContent = "";
  document.getElementById("friendNickInput").value = "";
};

window.sendFriendRequest = async () => {
  const friendNick = document.getElementById("friendNickInput").value.trim();
  const errorEl = document.getElementById("friendError");
  
  if (!friendNick) return;
  if (!currentUser) return;

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("nick", "==", friendNick));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
    errorEl.textContent = "Пользователь с таким ником не найден";
    return;
  }

  const friendDoc = querySnapshot.docs[0];
  const friendUid = friendDoc.id;
  const friendData = friendDoc.data();

  if (friendUid === currentUser.uid) {
    errorEl.textContent = "Нельзя добавить самого себя";
    return;
  }

  const myData = (await getDoc(doc(db, "users", currentUser.uid))).data();
  if (myData.friends?.includes(friendUid)) {
    errorEl.textContent = "Этот пользователь уже у вас в друзьях";
    return;
  }

  await updateDoc(doc(db, "users", friendUid), {
    pending: arrayUnion(currentUser.uid)
  });
  
  await updateDoc(doc(db, "users", currentUser.uid), {
    requestsSent: arrayUnion(friendUid)
  });

  closeFriendModal();
  alert("Запрос отправлен пользователю " + friendNick);
};

// ========== Профиль ==========
window.openProfileModal = async () => {
  if (!currentUser) return;
  
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));
  if (userSnap.exists()) {
    const data = userSnap.data();
    document.getElementById("profileUid").textContent = currentUser.uid;
    document.getElementById("profileEmail").textContent = currentUser.email;
    document.getElementById("profileNick").textContent = data.nick || currentUser.displayName;
    document.getElementById("profileAvatar").src = data.photoURL || "";
  }
  document.getElementById("profileModal").style.display = "block";
};

window.closeProfileModal = () => {
  document.getElementById("profileModal").style.display = "none";
};

window.updateProfileData = async () => {
  const newNick = document.getElementById("newNick").value.trim();
  const newPhoto = document.getElementById("newPhoto").value.trim();

  const updates = {};
  if (newNick) updates.nick = newNick;
  if (newPhoto) updates.photoURL = newPhoto;

  if (Object.keys(updates).length === 0) {
    closeProfileModal();
    return;
  }

  await updateDoc(doc(db, "users", currentUser.uid), updates);
  
  if (newNick) {
    await updateProfile(currentUser, { displayName: newNick });
  }

  alert("Профиль обновлён!");
  closeProfileModal();
  
  document.getElementById("userNick").textContent = newNick || currentUser.displayName;
  if (newPhoto) {
    document.getElementById("userAvatar").innerHTML = `<img src="${newPhoto}" style="width:36px; height:36px; border-radius:50%;">`;
  }
};

// ========== Выход ==========
window.logout = async () => {
  if (currentUser) {
    await updateDoc(doc(db, "users", currentUser.uid), { online: false });
  }
  signOut(auth).then(() => {
    window.location.href = "index.html";
  });
};
