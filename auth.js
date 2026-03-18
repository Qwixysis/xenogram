import { auth } from "./firebase.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  setPersistence, 
  browserLocalPersistence, 
  browserSessionPersistence, 
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const db = getFirestore();

window.register = async function() {
  const nick = document.getElementById("regNick").value;
  const email = document.getElementById("regEmail").value;
  const pass = document.getElementById("regPass").value;
  const remember = document.getElementById("regRemember").checked;

  const persistence = remember ? browserLocalPersistence : browserSessionPersistence;
  await setPersistence(auth, persistence);

  createUserWithEmailAndPassword(auth, email, pass)
    .then(async userCred => {
      await updateProfile(userCred.user, { displayName: nick });
      await setDoc(doc(db, "users", nick), {
        email: email,
        friends: [],
        pending: [],
        requestsSent: []
      });
    })
    .catch(err => alert(err.message));
};

window.login = async function() {
  const email = document.getElementById("logEmail").value;
  const pass = document.getElementById("logPass").value;
  const remember = document.getElementById("logRemember").checked;

  const persistence = remember ? browserLocalPersistence : browserSessionPersistence;
  await setPersistence(auth, persistence);

  signInWithEmailAndPassword(auth, email, pass)
    .catch(err => alert(err.message));
};

onAuthStateChanged(auth, user => {
  if (user) {
    window.location.href = "main.html";
  }
});
