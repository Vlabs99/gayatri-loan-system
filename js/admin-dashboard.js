import { auth, db } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, limit, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

async function loadDashboardData() {
    try {
        // 1. Fetch Loans for Summary Stats
        const loanSnap = await getDocs(collection(db, "loans"));
        let totalP = 0, totalExp = 0, totalRem = 0;

        loanSnap.forEach(doc => {
            const data = doc.data();
            totalP += Number(data.principal || 0);
            totalExp += Number(data.totalWithInterest || 0);
            totalRem += Number(data.remainingAmount || 0);
        });

        document.getElementById("totalPrincipal").innerText = `₹${totalP.toLocaleString('en-IN')}`;
        document.getElementById("totalExpected").innerText = `₹${totalExp.toLocaleString('en-IN')}`;
        document.getElementById("totalCollected").innerText = `₹${(totalExp - totalRem).toLocaleString('en-IN')}`;
        document.getElementById("totalPending").innerText = `₹${totalRem.toLocaleString('en-IN')}`;

        // 2. Fetch Recent 5 Payments for the Activity Table
        const recentQuery = query(collection(db, "ledger"), orderBy("date", "desc"), limit(5));
        const ledgerSnap = await getDocs(recentQuery);
        const recentTable = document.getElementById("recentLedgerBody");

        if (ledgerSnap.empty) {
            recentTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px;">No recent activity.</td></tr>`;
            return;
        }

        recentTable.innerHTML = "";
        const nameCache = {};

        for (const ledgerDoc of ledgerSnap.docs) {
            const data = ledgerDoc.data();
            const userId = data.userId;

            if (!nameCache[userId]) {
                const userSnap = await getDoc(doc(db, "users", userId));
                nameCache[userId] = userSnap.exists() ? userSnap.data().name : "Unknown User";
            }

            // --- UPDATED DATE & TIME FORMATTING ---
            let dateTimeDisplay = "Just now";
            if (data.date) {
                const dateObj = typeof data.date.toDate === 'function' ? data.date.toDate() : new Date(data.date);
                
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
                    <td style="font-size: 12px; color: #64748b; white-space: nowrap;">${dateTimeDisplay}</td>
                    <td><strong>${nameCache[userId]}</strong></td>
                    <td style="color: #64748b; font-size: 12px;">${data.note || 'Payment'}</td>
                    <td style="text-align: right;" class="amt-pos">₹${Number(data.amount).toLocaleString('en-IN')}</td>
                </tr>`;
            recentTable.innerHTML += row;
        }
    } catch (error) {
        console.error("Dashboard Logic Error:", error);
    }
}

// Authentication & Admin Check
onAuthStateChanged(auth, async (user) => {
    if (user) {
        let isAdmin = false;

        // Primary check: Verify signed-in user's Firebase UID against admins/{uid} document ID
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

        if (isAdmin) {
            loadDashboardData();
        } else {
            await signOut(auth);
            window.location.replace("admin-login.html");
        }
    } else {
        window.location.replace("admin-login.html");
    }
});

document.getElementById("logoutBtn")?.addEventListener("click", () => {
    signOut(auth).then(() => window.location.replace("admin-login.html"));
});

// Admin creation action
window.toggleAdminCreate = function () {
    window.location.href = "admin_register.html?role=admin";
};