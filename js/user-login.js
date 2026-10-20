import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
    const loginBtn = document.getElementById("loginBtn");

    // Check if button exists to avoid errors
    if (loginBtn) {
        loginBtn.addEventListener("click", async () => {
            const email = document.getElementById("email").value.trim();
            const password = document.getElementById("password").value.trim();

            if (!email || !password) {
                alert("Please enter both email and password.");
                return;
            }

            try {
                loginBtn.innerText = "Authenticating...";
                loginBtn.disabled = true;

                await signInWithEmailAndPassword(auth, email, password);
                
                alert("Login Successful! Redirecting to your dashboard...");
                
                // REDIRECT TO THE NEW PROFESSIONAL USER PAGE
                window.location.href = "user.html"; 

            } catch (error) {
                alert("Login Failed: " + error.message);
                loginBtn.innerText = "Sign In";
                loginBtn.disabled = false;
            }
        });
    }
});
