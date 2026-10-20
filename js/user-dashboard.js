import { auth, db } from "./firebase-config.js";
import { doc, getDoc, collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

/**
 * Main function to load all User Data
 */
async function loadUserData(user) {
    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            document.getElementById("userName").innerText = `Welcome, ${userSnap.data().name}!`;
        }

        const q = query(collection(db, "loans"), where("userId", "==", user.uid), where("status", "==", "active"));
        const loanSnap = await getDocs(q);

        if (!loanSnap.empty) {
            // This currently handles the first active loan found
            const loanDoc = loanSnap.docs[0];
            const loanData = loanDoc.data();
            
            const remaining = loanData.remainingAmount || 0;
            const totalWithInterest = loanData.totalWithInterest || 0;
            const paidTotal = totalWithInterest - remaining;

            document.getElementById("userRemaining").innerText = `₹${remaining.toLocaleString('en-IN')}`;
            document.getElementById("userPrincipal").innerText = `₹${loanData.principal.toLocaleString('en-IN')}`;
            document.getElementById("userPaid").innerText = `₹${paidTotal.toLocaleString('en-IN')}`;

            loadUserLedger(loanDoc.id);
        } else {
            document.getElementById("userLedgerBody").innerHTML = `<tr><td colspan="3" style="text-align:center; padding:30px; color:#94a3b8;">No active loans found.</td></tr>`;
        }
    } catch (error) {
        console.error("User Dashboard Error:", error);
    }
}

/**
 * Fetches and renders the specific payment records with Date AND Time
 */
async function loadUserLedger(loanId) {
    const ledgerTable = document.getElementById("userLedgerBody");
    
    try {
        const q = query(collection(db, "ledger"), where("loanId", "==", loanId), orderBy("date", "desc"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            ledgerTable.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:#94a3b8;">No payment history yet.</td></tr>`;
            return;
        }

        ledgerTable.innerHTML = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            
            // --- UPDATED DATE & TIME FORMATTING ---
            let dateTimeDisplay = "N/A";
            if (data.date) {
                const dateObj = typeof data.date.toDate === 'function' ? data.date.toDate() : new Date(data.date);
                
                // Format: DD/MM/YYYY, HH:MM AM/PM
                dateTimeDisplay = dateObj.toLocaleString('en-IN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });
            }

            const row = `
                <tr>
                    <td style="font-size: 12px; line-height: 1.2;">${dateTimeDisplay}</td>
                    <td style="color: #64748b; font-size: 12px;">${data.note || 'Payment'}</td>
                    <td class="amt-paid">₹${data.amount.toLocaleString('en-IN')}</td>
                </tr>`;
            ledgerTable.innerHTML += row;
        });
    } catch (error) {
        console.error("Ledger Fetch Error:", error);
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) loadUserData(user);
    else window.location.href = "index.html";
});

document.getElementById("logoutBtn").addEventListener("click", () => {
    signOut(auth).then(() => window.location.href = "index.html");
});