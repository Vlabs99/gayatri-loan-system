// js/admin-auth.js

import { auth, db } from "./firebase-config.js";

import { 
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import { 
  doc, 
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

async function performAdminLogin() {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const msgLabel = document.getElementById("msg");

  const email = emailInput ? emailInput.value.trim() : "";
  const password = passwordInput ? passwordInput.value.trim() : "";

  if (!email || !password) {
    if (msgLabel) msgLabel.innerText = "Please fill all fields.";
    return;
  }

  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    const user = userCred.user;

    // Verify admin authorization against admins/{uid} document ID
    let isAdmin = false;
    try {
      const adminRef = doc(db, "admins", user.uid);
      const adminDoc = await getDoc(adminRef);
      if (adminDoc.exists()) {
        isAdmin = true;
      }
    } catch (checkErr) {
      console.warn("Could not check 'admins' collection:", checkErr.message);
    }

    // Secondary fallback: Check 'users' collection for role == 'admin'
    if (!isAdmin) {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists() && userSnap.data()?.role === "admin") {
          isAdmin = true;
          // Auto-sync missing admins/{uid} document for this verified admin
          try {
            const uData = userSnap.data();
            await setDoc(doc(db, "admins", user.uid), {
              uid: user.uid,
              email: user.email || uData.email || "",
              role: "admin",
              name: uData.name || "",
              createdAt: serverTimestamp()
            }, { merge: true });
          } catch (syncErr) {
            console.warn("Could not sync admins document:", syncErr.message);
          }
        }
      } catch (checkErr) {
        console.warn("Could not check 'users' collection role:", checkErr.message);
      }
    }

    if (isAdmin) {
      alert("Admin Access Granted");
      window.location.href = "admin.html";
    } else {
      await signOut(auth);
      const accessDeniedMsg = "Access Denied: Your account does not have administrator privileges.";
      if (msgLabel) msgLabel.innerText = accessDeniedMsg;
      alert(accessDeniedMsg);
    }

  } catch (error) {
    if (msgLabel) msgLabel.innerText = error.message ? error.message.replace("Firebase: ", "") : "Access Denied: Invalid Credentials";
    alert(error.message);
  }
}

window.adminLogin = performAdminLogin;
window.loginAdmin = performAdminLogin;

