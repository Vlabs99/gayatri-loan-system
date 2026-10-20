import { auth, db } from "./firebase-config.js";
import { collection, getDocs, addDoc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const userSelect = document.getElementById("userSelect");
const loanForm = document.getElementById("loanForm");
const principalInput = document.getElementById("principal");
const rateInput = document.getElementById("rate");
const monthsInput = document.getElementById("months");

// View Elements for live calculation
const viewPrincipal = document.getElementById("view-principal");
const viewInterest = document.getElementById("view-interest");
const viewTotal = document.getElementById("view-total");

/**
 * Live Interest Calculation Logic
 * Formula: Interest = (P × R × T) / 100
 */
function updateCalculations() {
    const P = parseFloat(principalInput.value) || 0;
    const R = parseFloat(rateInput.value) || 0;
    const T = parseFloat(monthsInput.value) || 0;

    const interest = (P * R * T) / 100;
    const total = P + interest;

    viewPrincipal.innerText = `₹${P.toLocaleString('en-IN')}`;
    viewInterest.innerText = `₹${interest.toLocaleString('en-IN')}`;
    viewTotal.innerText = `₹${total.toLocaleString('en-IN')}`;

    return { P, R, T, interest, total };
}

[principalInput, rateInput, monthsInput].forEach(input => {
    input.addEventListener("input", updateCalculations);
});

/**
 * Fetch users to populate the dropdown
 */
async function loadUsers() {
    const q = query(collection(db, "users"), orderBy("name", "asc"));
    const snapshot = await getDocs(q);
    snapshot.forEach(doc => {
        const user = doc.data();
        const option = document.createElement("option");
        option.value = doc.id;
        option.textContent = `${user.name} (${user.phone})`;
        userSelect.appendChild(option);
    });
}

/**
 * Save Loan to Firestore
 */
loanForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("submitBtn");
    const { P, R, T, interest, total } = updateCalculations();
    
    if (!userSelect.value) {
        alert("Please select a customer first.");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = "Saving Loan Record...";

    try {
        await addDoc(collection(db, "loans"), {
            userId: userSelect.value,
            principal: P,
            interestRate: R,
            months: T,
            totalWithoutInterest: P,
            totalWithInterest: total,
            remainingAmount: total, // Initial balance is the full amount
            status: "active",
            startDate: new Date().toISOString(),
            createdAt: serverTimestamp()
        });

        alert("Loan created successfully!");
        loanForm.reset();
        updateCalculations();
    } catch (error) {
        alert("Error saving loan: " + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Create & Save Loan";
    }
});

onAuthStateChanged(auth, (user) => {
    if (user) loadUsers();
    else window.location.replace("admin-login.html");
});
