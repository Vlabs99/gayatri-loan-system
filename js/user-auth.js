import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

window.register = async function() {
    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const address = document.getElementById("address").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msgLabel = document.getElementById("msg");

    if (!email || !password || !name) {
        alert("Please fill in required fields.");
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Store user details in Firestore
        await setDoc(doc(db, "users", user.uid), {
            name: name,
            phone: phone,
            address: address,
            email: email,
            role: "user",
            createdAt: new Date()
        });

        alert("Account Created Successfully!");
        
        // REDIRECT TO THE NEW PROFESSIONAL USER PAGE
        window.location.href = "user.html";

    } catch (error) {
        if(msgLabel) {
            msgLabel.style.display = "block";
            msgLabel.innerText = error.message;
        }
        alert("Registration Error: " + error.message);
    }
};
