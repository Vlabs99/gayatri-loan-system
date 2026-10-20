import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

window.loginAdmin = async function() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msgLabel = document.getElementById("msg");

    if (!email || !password) {
        if(msgLabel) msgLabel.innerText = "Please fill all fields.";
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
        
        alert("Admin Access Granted");
        
        // REDIRECT TO THE NEW PROFESSIONAL ADMIN PAGE
        window.location.href = "admin.html";

    } catch (error) {
        if(msgLabel) msgLabel.innerText = error.message ? error.message.replace("Firebase: ", "") : "Access Denied: Invalid Credentials";
        console.error("Admin Login Error:", error);
    }
};
