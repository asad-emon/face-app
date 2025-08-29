import React, { useState, useEffect } from 'react';
import { auth, signInWithGooglePopup } from './firebase';
import { onAuthStateChanged, signOut } from "firebase/auth";

const signOutUser = () => signOut(auth);

const Authentication = () => {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithGooglePopup();
    } catch (error) {
      console.error('Error signing in with Google', error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
    } catch (error) {
      console.error('Error signing out', error);
    }
  };

  return (
    <div>
      {user ? (
        <div className="row" style={{ alignItems: 'center'}}>
          <img src={user.photoURL} alt="Profile" style={{ width: '50px', height: '50px', borderRadius: '50%' }} />
          <div style={{ padding: '10px' }}>Welcome, {user.displayName}</div>
          <button className="btn" onClick={handleSignOut}>Sign Out</button>        
        </div>
      ) : (
        <button className="btn" onClick={handleSignIn}>Sign in with Google</button>
      )}
    </div>
  );
};

export default Authentication;