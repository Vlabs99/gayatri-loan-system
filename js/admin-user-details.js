import { auth, db } from "./firebase-config.js";
import { 
    doc, getDoc, collection, query, where, getDocs, orderBy, addDoc, updateDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// 1. Extract Loan ID from the URL (?loanId=XXXXX)
const urlParams = new URLSearchParams(window.location.search);
const loanId = urlParams.get("loanId");

async function loadPageData() {
    const ledgerTable = document.getElementById("ledgerTableBody");

    // ERROR CHECK: If no ID in URL, stop and show message
    if (!loanId) {
        console.error("Critical Error: No Loan ID in URL");
        ledgerTable.innerHTML = "<tr><td colspan='3' style='color:red; text-align:center; padding:20px;'>Error: No Loan Selected. Please go back to Customers List.</td></tr>";
        return;
    }

    try {
        // 2. Get Loan Document
        const loanRef = doc(db, "loans", loanId);
        const loanSnap = await getDoc(loanRef);

        if (!loanSnap.exists()) {
            ledgerTable.innerHTML = "<tr><td colspan='3' style='text-align:center;'>Loan record not found.</td></tr>";
            return;
        }

        const loanData = loanSnap.data();

        // 3. Get User Document
        const userSnap = await getDoc(doc(db, "users", loanData.userId));
        const userData = userSnap.data();

        // 4. Update UI Header
        document.getElementById("custName").innerText = userData.name || "Unknown";
        document.getElementById("productName").innerText = loanData.productName || "Loan";
        document.getElementById("remainingAmt").innerText = `₹${loanData.remainingAmount.toLocaleString('en-IN')}`;

        // 5. Fetch History (Ledger)
        const q = query(collection(db, "ledger"), where("loanId", "==", loanId), orderBy("date", "desc"));
        const ledgerSnap = await getDocs(q);

        ledgerTable.innerHTML = "";

        if (ledgerSnap.empty) {
            ledgerTable.innerHTML = "<tr><td colspan='3' style='text-align:center; padding:20px;'>No payment history yet.</td></tr>";
            return;
        }

        ledgerSnap.forEach(payDoc => {
            const pay = payDoc.data();
            
            // Safe Date+Time Formatting
            let timeString = "Processing...";
            if (pay.date) {
                const d = typeof pay.date.toDate === 'function' ? pay.date.toDate() : new Date(pay.date);
                timeString = d.toLocaleString('en-IN', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true
                });
            }

            ledgerTable.innerHTML += `
                <tr>
                    <td style="font-size:12px; color:#64748b;">${timeString}</td>
                    <td>${pay.note || 'Cash'}</td>
                    <td style="text-align:right; font-weight:700; color:#16a34a;">₹${pay.amount.toLocaleString('en-IN')}</td>
                </tr>`;
        });

    } catch (error) {
        console.error("Data Load Error:", error);
        if (error.message.includes("index")) {
            ledgerTable.innerHTML = "<tr><td colspan='3' style='text-align:center; color:blue;'>Firebase is building the data index. Please wait 2 minutes and refresh.</td></tr>";
        }
    }
}

// Global payment function
window.addPayment = async function() {
    const amt = parseFloat(document.getElementById("payAmount").value);
    const note = document.getElementById("payNote").value;

    if (!amt || amt <= 0) return alert("Enter valid amount");

    try {
        const loanRef = doc(db, "loans", loanId);
        const loanSnap = await getDoc(loanRef);
        const loanData = loanSnap.data();

        if (amt > loanData.remainingAmount) return alert("Amount too high!");

        await addDoc(collection(db, "ledger"), {
            loanId: loanId,
            userId: loanData.userId,
            amount: amt,
            note: note,
            date: serverTimestamp()
        });

        await updateDoc(loanRef, {
            remainingAmount: loanData.remainingAmount - amt
        });

        alert("Success!");
        location.reload();
    } catch (e) { console.error(e); }
};

onAuthStateChanged(auth, (user) => {
    if (user) loadPageData();
    else window.location.href = "index.html";
});