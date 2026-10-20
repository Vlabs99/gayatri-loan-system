import { auth, db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

async function loadCustomers() {
    const tableBody = document.getElementById("userTableBody");
    if (!tableBody) return;

    try {
        const usersSnap = await getDocs(collection(db, "users"));
        if (usersSnap.empty) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 40px; color: var(--secondary);">No registered customers found.</td></tr>`;
            return;
        }

        let html = "";
        usersSnap.forEach((userDoc) => {
            const user = userDoc.data();
            const uid = userDoc.id;
            html += `
                <tr>
                    <td>
                        <span class="user-name">${user.name || 'Unnamed'}</span>
                        <span class="user-email">${user.email || 'No email'} &bull; UID: ${uid.slice(0, 8)}...</span>
                    </td>
                    <td>${user.phone || 'N/A'}</td>
                    <td>${user.address || 'N/A'}</td>
                    <td>
                        <button class="btn-view" onclick="location.href='admin.html'">Manage</button>
                    </td>
                </tr>
            `;
        });
        tableBody.innerHTML = html;
    } catch (err) {
        console.error("Error loading users:", err);
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red; padding: 20px;">Error loading customers: ${err.message}</td></tr>`;
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        loadCustomers();
    } else {
        window.location.href = "admin-login.html";
    }
});