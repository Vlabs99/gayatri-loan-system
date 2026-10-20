import { auth, db } from "./firebase-config.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

        // Standard parse (ISO 8601, RFC2822, YYYY-MM-DD)
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
    if (!data) return "N/A";
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
    return "N/A";
}

async function loadFullHistory() {
    const tableBody = document.getElementById("globalLedgerBody");
    if (!tableBody) return;
    
    try {
        // Query ALL payments across ALL users
        const snapshot = await getDocs(collection(db, "ledger"));

        if (snapshot.empty) {
            tableBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:40px;'>No payments found.</td></tr>";
            return;
        }

        // Collect all transactions and compute normalized timestamps
        const allTransactions = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data() || {};
            allTransactions.push({
                id: docSnap.id,
                ...data,
                _timestamp: extractPaymentTimestamp(data)
            });
        });

        // Sort newest payments first (descending order by transaction date and time)
        allTransactions.sort((a, b) => b._timestamp - a._timestamp);

        tableBody.innerHTML = "";
        const nameCache = {}; // To avoid asking Firebase for the same name twice

        for (const item of allTransactions) {
            const uId = item.userId || item.customerId || item.uid;

            // Get the User's Name
            if (uId && !nameCache[uId]) {
                try {
                    const uSnap = await getDoc(doc(db, "users", uId));
                    nameCache[uId] = uSnap.exists()
                        ? (uSnap.data().name || uSnap.data().fullName || "Unknown User")
                        : (item.customerName || item.name || item.userName || "Customer");
                } catch (e) {
                    nameCache[uId] = item.customerName || item.name || item.userName || "Customer";
                }
            }

            const customerName = (uId && nameCache[uId])
                ? nameCache[uId]
                : (item.customerName || item.name || item.userName || "Customer");

            const dateTimeDisplay = formatPaymentDateTime(item);
            const noteDisplay = item.note || item.description || item.paymentNote || item.type || "Payment";
            const amountVal = Number(item.amount || item.paidAmount || 0);

            tableBody.innerHTML += `
                <tr>
                    <td class="timestamp">${dateTimeDisplay}</td>
                    <td><strong>${customerName}</strong></td>
                    <td style="color: #64748b;">${noteDisplay}</td>
                    <td class="amt">₹${amountVal.toLocaleString('en-IN')}</td>
                </tr>
            `;
        }
    } catch (err) {
        console.error("Ledger Error:", err);
        tableBody.innerHTML = `<tr><td colspan='4' style='text-align:center; color:red; padding:20px;'>Error loading ledger: ${err.message}</td></tr>`;
    }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        let isAdmin = false;
        try {
            const adminSnap = await getDoc(doc(db, "admins", user.uid));
            if (adminSnap.exists()) isAdmin = true;
        } catch (e) {}

        if (!isAdmin) {
            try {
                const userSnap = await getDoc(doc(db, "users", user.uid));
                if (userSnap.exists() && userSnap.data()?.role === "admin") isAdmin = true;
            } catch (e) {}
        }

        if (isAdmin) {
            loadFullHistory();
        } else {
            window.location.replace("admin-login.html");
        }
    } else {
        window.location.replace("admin-login.html");
    }
});