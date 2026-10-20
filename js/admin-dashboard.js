import { auth, db } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, limit, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

/**
 * Extracts a normalized numeric epoch timestamp (in ms) from various Firestore date fields and formats.
 * Handles Firestore Timestamps, JS Dates, ISO strings, legacy string formats (DD/MM/YYYY, YYYY-MM-DD), and numbers.
 */
function extractPaymentTimestamp(data) {
    if (!data) return 0;
    const raw = data.date || data.createdAt || data.timestamp || data.paymentDate || data.time || data.created_at || data.dateTime;
    if (!raw) return 0;

    // 1. Firestore Timestamp instance (has toDate function)
    if (typeof raw.toDate === "function") {
        try {
            const d = raw.toDate();
            return isNaN(d.getTime()) ? 0 : d.getTime();
        } catch (e) {}
    }

    // 2. Firestore Timestamp-like plain object { seconds, nanoseconds }
    if (typeof raw.seconds === "number") {
        return (raw.seconds * 1000) + (raw.nanoseconds ? Math.floor(raw.nanoseconds / 1000000) : 0);
    }

    // 3. JavaScript Date object
    if (raw instanceof Date) {
        return isNaN(raw.getTime()) ? 0 : raw.getTime();
    }

    // 4. Numeric epoch timestamp
    if (typeof raw === "number") {
        return raw > 1e11 ? raw : raw * 1000;
    }

    // 5. String parsing
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return 0;

        // Standard parse (ISO 8601, RFC2822)
        const parsed = Date.parse(trimmed);
        if (!isNaN(parsed)) {
            return parsed;
        }

        // DD/MM/YYYY or DD-MM-YYYY with optional time
        const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const month = parseInt(dmyMatch[2], 10) - 1;
            const year = parseInt(dmyMatch[3], 10);
            const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
            const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
            const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
            const d = new Date(year, month, day, hour, min, sec);
            if (!isNaN(d.getTime())) return d.getTime();
        }

        // YYYY/MM/DD or YYYY-MM-DD with optional time
        const ymdMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (ymdMatch) {
            const year = parseInt(ymdMatch[1], 10);
            const month = parseInt(ymdMatch[2], 10) - 1;
            const day = parseInt(ymdMatch[3], 10);
            const hour = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
            const min = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
            const sec = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
            const d = new Date(year, month, day, hour, min, sec);
            if (!isNaN(d.getTime())) return d.getTime();
        }
    }

    return 0;
}

/**
 * Formats a transaction date for display.
 */
function formatPaymentDateTime(data) {
    if (!data) return "Just now";
    const ts = extractPaymentTimestamp(data);
    if (ts > 0) {
        const d = new Date(ts);
        return d.toLocaleString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        });
    }

    const raw = data.date || data.createdAt || data.timestamp || data.paymentDate || data.time;
    if (typeof raw === "string" && raw.trim()) {
        return raw.trim();
    }
    return "Just now";
}

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

        // 2. Fetch all payment transactions from the Firestore ledger collection
        const recentTable = document.getElementById("recentLedgerBody");
        if (!recentTable) return;

        const ledgerSnap = await getDocs(collection(db, "ledger"));

        if (ledgerSnap.empty) {
            recentTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px;">No recent activity.</td></tr>`;
            return;
        }

        // Collect all transactions and compute normalized timestamps
        const allTransactions = [];
        ledgerSnap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            allTransactions.push({
                id: docSnap.id,
                ...data,
                _timestamp: extractPaymentTimestamp(data)
            });
        });

        // Sort newest payments first (descending order by transaction date and time)
        allTransactions.sort((a, b) => b._timestamp - a._timestamp);

        // Display the top 5 most recent payments
        const recent5 = allTransactions.slice(0, 5);

        recentTable.innerHTML = "";
        const nameCache = {};

        for (const item of recent5) {
            const userId = item.userId || item.customerId || item.uid;

            if (userId && !nameCache[userId]) {
                try {
                    const userSnap = await getDoc(doc(db, "users", userId));
                    nameCache[userId] = userSnap.exists()
                        ? (userSnap.data().name || userSnap.data().fullName || "Unknown User")
                        : (item.customerName || item.name || item.userName || "Customer");
                } catch (e) {
                    nameCache[userId] = item.customerName || item.name || item.userName || "Customer";
                }
            }

            const customerName = (userId && nameCache[userId])
                ? nameCache[userId]
                : (item.customerName || item.name || item.userName || "Customer");

            const dateTimeDisplay = formatPaymentDateTime(item);
            const noteDisplay = item.note || item.description || item.paymentNote || item.type || "Payment";
            const amountNum = Number(item.amount || item.paidAmount || 0);

            const row = `
                <tr>
                    <td style="font-size: 12px; color: #64748b; white-space: nowrap;">${dateTimeDisplay}</td>
                    <td><strong>${customerName}</strong></td>
                    <td style="color: #64748b; font-size: 12px;">${noteDisplay}</td>
                    <td style="text-align: right;" class="amt-pos">₹${amountNum.toLocaleString('en-IN')}</td>
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