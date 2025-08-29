import React, { useState, useEffect } from 'react';
import { auth, signInWithGooglePopup } from './firebase';
import { onAuthStateChanged, signOut } from "firebase/auth";

const signOutUser = () => signOut(auth);

const Authentication = ({ children }) => {
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
        <>
          <div className="row space-between">
            <div className="">
              <img src={user.photoURL} alt="Profile" style={{ width: '80px', height: '80px', borderRadius: '50%' }} />
            </div>
            <div className="text-end">
              <div style={{ padding: '10px' }}>Welcome, {user.displayName}</div>
              <button className="btn" onClick={handleSignOut}>Sign Out</button>        
            </div>
          </div>
          {children}
        </>
      ) : (
        <button className="btn" onClick={handleSignIn}>Sign in with Google</button>
      )}
    </div>
  );
};

export default Authentication;