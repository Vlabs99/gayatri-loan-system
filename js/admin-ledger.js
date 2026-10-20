import { auth, db } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

async function loadFullHistory() {
    const tableBody = document.getElementById("globalLedgerBody");
    
    try {
        // Query ALL payments across ALL users, ordered by newest first
        const q = query(collection(db, "ledger"), orderBy("date", "desc"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            tableBody.innerHTML = "<tr><td colspan='4' style='text-align:center;'>No payments found.</td></tr>";
            return;
        }

        tableBody.innerHTML = "";
        const nameCache = {}; // To avoid asking Firebase for the same name twice

        for (const ledgerDoc of snapshot.docs) {
            const data = ledgerDoc.data();
            const uId = data.userId;

            // Get the User's Name
            if (!nameCache[uId]) {
                const uSnap = await getDoc(doc(db, "users", uId));
                nameCache[uId] = uSnap.exists() ? uSnap.data().name : "Unknown User";
            }

            // --- DETAILED DATE & TIME ---
            let dateTimeDisplay = "N/A";
            if (data.date) {
                const dateObj = typeof data.date.toDate === 'function' ? data.date.toDate() : new Date(data.date);
                dateTimeDisplay = dateObj.toLocaleString('en-IN', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true
                });
            }

            tableBody.innerHTML += `
                <tr>
                    <td class="timestamp">${dateTimeDisplay}</td>
                    <td><strong>${nameCache[uId]}</strong></td>
                    <td style="color: #64748b;">${data.note || 'Payment'}</td>
                    <td class="amt">₹${Number(data.amount).toLocaleString('en-IN')}</td>
                </tr>
            `;
        }
    } catch (err) {
        console.error("Ledger Error:", err);
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) loadFullHistory();
    else window.location.replace("admin-login.html");
});