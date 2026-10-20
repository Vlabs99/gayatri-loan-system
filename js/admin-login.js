import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

async function performAdminLogin() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msgLabel = document.getElementById("msg");

    if (!email || !password) {
        if (msgLabel) msgLabel.innerText = "Please fill all fields.";
        return;
    }

    try {
        const userCred = await signInWithEmailAndPassword(auth, email, password);
        const user = userCred.user;

        // Primary check: Verify signed-in user's Firebase UID against admins/{uid} document ID
        let isAdmin = false;
        try {
            const adminSnap = await getDoc(doc(db, "admins", user.uid));
            if (adminSnap.exists()) {
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

        if (!isAdmin) {
            await signOut(auth);
            const accessDeniedMsg = "Access Denied: Your account does not have administrator privileges.";
            if (msgLabel) msgLabel.innerText = accessDeniedMsg;
            alert(accessDeniedMsg);
            return;
        }

        alert("Admin Access Granted");
        window.location.href = "admin_dashboard.html";

    } catch (error) {
        if (msgLabel) msgLabel.innerText = error.message ? error.message.replace("Firebase: ", "") : "Access Denied: Invalid Credentials";
        console.error("Admin Login Error:", error);
    }
}

window.loginAdmin = performAdminLogin;
window.adminLogin = performAdminLogin;
