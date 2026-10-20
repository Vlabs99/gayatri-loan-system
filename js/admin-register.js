import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const registerForm = document.getElementById("registerForm");
const regBtn = document.getElementById("regBtn");
const roleSelect = document.getElementById("regRole");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const roleInfoNote = document.getElementById("roleInfoNote");

let isCreatingAccount = false;

// Check URL params for role pre-selection (e.g. admin_register.html?role=admin)
const urlParams = new URLSearchParams(window.location.search);
const requestedRole = urlParams.get("role");
if (roleSelect && requestedRole === "admin") {
    roleSelect.value = "admin";
}

function updateRoleUI() {
    const selectedRole = roleSelect ? roleSelect.value : (requestedRole === "user" ? "user" : "admin");
    if (selectedRole === "admin") {
        if (pageTitle) pageTitle.innerText = "Register New Administrator";
        if (pageSubtitle) pageSubtitle.innerText = "Create an administrator account with full dashboard access.";
        if (roleInfoNote) roleInfoNote.innerHTML = "<strong>Admin Notice:</strong> This creates an authorized admin profile in <code>admins/{uid}</code> and <code>users/{uid}</code>.";
        if (regBtn) regBtn.innerText = "Create Admin Account";
    } else {
        if (pageTitle) pageTitle.innerText = "Register New Customer";
        if (pageSubtitle) pageSubtitle.innerText = "Create a profile and login credentials for a new borrower.";
        if (roleInfoNote) roleInfoNote.innerHTML = "<strong>Customer Notice:</strong> This creates a customer profile in <code>users/{uid}</code> with borrower access.";
        if (regBtn) regBtn.innerText = "Create Customer Account";
    }
}

if (roleSelect) {
    roleSelect.addEventListener("change", updateRoleUI);
    updateRoleUI();
}

/**
 * Handles account creation (Admin or Customer)
 */
registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const role = roleSelect ? roleSelect.value : (requestedRole === "user" ? "user" : "admin");
    const name = document.getElementById("regName").value.trim();
    const phone = document.getElementById("regPhone").value.trim();
    const address = document.getElementById("regAddress").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;

    // Basic Validation
    if (password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }

    regBtn.disabled = true;
    regBtn.innerText = "Creating Account...";
    isCreatingAccount = true;

    try {
        // 1. Create User in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;

        if (role === "admin") {
            // 2a. Create Admin document in 'admins' collection keyed by UID
            await setDoc(doc(db, "admins", newUser.uid), {
                uid: newUser.uid,
                email: email,
                role: "admin",
                name: name,
                phone: phone,
                createdAt: serverTimestamp()
            });

            // 2b. Also save profile to 'users' collection with role === "admin"
            await setDoc(doc(db, "users", newUser.uid), {
                name: name,
                phone: phone,
                address: address,
                email: email,
                role: "admin",
                createdAt: serverTimestamp()
            });

            alert(`Administrator account for ${name} (${email}) created successfully!`);
        } else {
            // Customer profile only
            await setDoc(doc(db, "users", newUser.uid), {
                name: name,
                phone: phone,
                address: address,
                email: email,
                role: "user",
                createdAt: serverTimestamp()
            });

            alert(`Customer account for ${name} registered successfully!`);
        }

        registerForm.reset();
        if (roleSelect) {
            roleSelect.value = role;
            updateRoleUI();
        }

    } catch (error) {
        console.error("Registration Error:", error);
        alert("Registration Error: " + error.message);
    } finally {
        regBtn.disabled = false;
        isCreatingAccount = false;
        updateRoleUI();
    }
});

// Admin Authorization Check for this page
onAuthStateChanged(auth, async (user) => {
    if (isCreatingAccount) return;

    if (!user) {
        window.location.replace("admin-login.html");
        return;
    }

    let isAdmin = false;
    try {
        const adminSnap = await getDoc(doc(db, "admins", user.uid));
        if (adminSnap.exists()) {
            isAdmin = true;
        }
    } catch (e) {
        console.warn("Could not check admins collection:", e);
    }

    if (!isAdmin) {
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            if (userSnap.exists() && userSnap.data()?.role === "admin") {
                isAdmin = true;
            }
        } catch (e) {
            console.warn("Could not check users collection:", e);
        }
    }

    if (!isAdmin) {
        alert("Access Denied: Your account does not have administrator privileges.");
        await signOut(auth);
        window.location.replace("admin-login.html");
    }
});
