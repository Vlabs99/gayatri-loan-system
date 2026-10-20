// js/admin-auth.js

import { auth, db } from "./firebase-config.js";

import { 
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import { 
  doc, 
  getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";


window.adminLogin = async function(){

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {

    const userCred = await signInWithEmailAndPassword(auth,email,password);

    const adminRef = doc(db,"admins",userCred.user.uid);
    const adminDoc = await getDoc(adminRef);

    if(adminDoc.exists()){
        alert("Admin Login Successful");
        window.location = "admin.html";
    } else {
        alert("You are not an admin");
        await signOut(auth);
    }

  } catch(error){
      alert(error.message);
  }

};

