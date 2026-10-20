import { auth, db } from "./firebase-config.js";

import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";


auth.onAuthStateChanged(async(user)=>{

  if(user){

    const q = query(collection(db,"loans"),where("userId","==",user.uid));
    const querySnap = await getDocs(q);

    querySnap.forEach(docSnap=>{

      const data = docSnap.data();

      document.getElementById("loanDetails").innerHTML += `
        <p>Principal: ${data.principal}</p>
        <p>Total Amount: ${data.totalAmount}</p>
        <p>EMI: ${data.emiAmount}</p>
        <p>Remaining: ${data.remainingAmount}</p>
        <hr>
      `;
    });
  }

});
