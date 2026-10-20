import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const loginForm = document.getElementById("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("email").value;
        const password = document.getElementById("password").value;

        try {
            // 1. Try to Sign In
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            console.log("Logged in UID:", user.uid);

            // 2. Check Admins Collection
            const adminDocRef = doc(db, "admins", user.uid);
            const adminDoc = await getDoc(adminDocRef);

            if (adminDoc.exists() && adminDoc.data().role === "admin") {
                console.log("Admin verified. Redirecting...");
                window.location.href = "admin_dashboard.html";
            } else {
                // 3. Check Users Collection if not Admin
                const userDocRef = doc(db, "users", user.uid);
                const userDoc = await getDoc(userDocRef);

                if (userDoc.exists()) {
                    window.location.href = "user.html";
                } else {
                    alert("Account exists but no profile found in Database.");
                }
            }
        } catch (error) {
            console.error("Login Error Details:", error.code, error.message);
            alert("Login Failed: " + error.message);
        }
    });
}

// Global Protection: If a user tries to access a page without being logged in
export function checkAuth(roleRequired) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = "index.html";
        } else if (roleRequired === "admin") {
            const adminDoc = await getDoc(doc(db, "admins", user.uid));
            if (!adminDoc.exists()) {
                window.location.href = "user.html";
            }
        }
    });
}