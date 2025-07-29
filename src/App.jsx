import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, onSnapshot, doc, getDoc, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Clipboard, UserPlus, Send, Users, Gift, ArrowRight, Edit, Check, LogIn, PlusSquare, LogOut } from 'lucide-react';

// --- Firebase Configuration ---
// Make sure to replace this with your actual Firebase config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID,
  measurementId: import.meta.env.VITE_MEASUREMENT_ID
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Helper to get/set last joined group from localStorage ---
const getLastGroupId = () => localStorage.getItem('lastGroupId');
const setLastGroupId = (id) => localStorage.setItem('lastGroupId', id);
const clearLastGroupId = () => localStorage.removeItem('lastGroupId');


// --- Main App Component ---
export default function App() {
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    const [userName, setUserName] = useState('');
    const [editingName, setEditingName] = useState('');
    const [isEditingName, setIsEditingName] = useState(false);

    const [currentGroupId, setCurrentGroupId] = useState(getLastGroupId());
    const [groupName, setGroupName] = useState('');
    const [groupMembers, setGroupMembers] = useState([]);
    
    const [receivedCompliments, setReceivedCompliments] = useState([]);
    const [sentCompliments, setSentCompliments] = useState([]);

    const [complimentMessage, setComplimentMessage] = useState('');
    const [selectedFriendId, setSelectedFriendId] = useState('');
    
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

    // --- Authentication ---
    // This hook now *only* handles authentication state.
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                // If we have a user, set their ID and mark auth as ready.
                setUserId(user.uid);
                setIsAuthReady(true);
            } else {
                // If there's no user, attempt to sign in. The listener will
                // fire again on success, running the code block above.
                signInAnonymously(auth).catch(err => console.error("Anonymous Auth Error:", err));
            }
        });
        return () => unsubscribe();
    }, []);

    // --- Profile Data Fetching ---
    // This hook runs *after* authentication is ready.
    useEffect(() => {
        if (!isAuthReady || !userId) return; // Don't run if auth isn't ready

        const userProfileRef = doc(db, "users", userId);
        const unsubscribeProfile = onSnapshot(userProfileRef, (doc) => {
            if (doc.exists() && doc.data().name) {
                const name = doc.data().name;
                setUserName(name);
                setEditingName(name);
                setIsEditingName(false);
            } else {
                setIsEditingName(true);
            }
        });

        return () => unsubscribeProfile();
    }, [isAuthReady, userId]); // It re-runs if auth status or user ID changes.


    // --- Group and Compliments Data Fetching ---
    useEffect(() => {
        if (!isAuthReady || !userId || !currentGroupId) {
            setGroupMembers([]);
            setReceivedCompliments([]);
            setSentCompliments([]);
            setGroupName('');
            return;
        };

        const groupDocRef = doc(db, "groups", currentGroupId);
        const unsubscribeGroup = onSnapshot(groupDocRef, (doc) => {
            if (doc.exists()) {
                setGroupName(doc.data().groupName);
            } else {
                showNotification("The group you were in may have been deleted.", "error");
                handleLeaveGroup();
            }
        });

        const membersQuery = query(collection(db, `groups/${currentGroupId}/members`));
        const unsubscribeMembers = onSnapshot(membersQuery, (snapshot) => {
            const members = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setGroupMembers(members);
        });

        const receivedQuery = query(collection(db, "compliments"), where("receiverId", "==", userId), where("groupId", "==", currentGroupId));
        const unsubscribeReceived = onSnapshot(receivedQuery, (snapshot) => {
            const compliments = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            setReceivedCompliments(compliments);
        });

        const sentQuery = query(collection(db, "compliments"), where("senderId", "==", userId), where("groupId", "==", currentGroupId));
        const unsubscribeSent = onSnapshot(sentQuery, (snapshot) => {
            const compliments = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            setSentCompliments(compliments);
        });

        return () => {
            unsubscribeGroup();
            unsubscribeMembers();
            unsubscribeReceived();
            unsubscribeSent();
        };
    }, [isAuthReady, userId, currentGroupId]);

    const memberMap = useMemo(() => new Map(groupMembers.map(m => [m.id, m.userName])), [groupMembers]);

    const showNotification = (message, type = 'success') => {
        setNotification({ show: true, message, type });
        setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 3000);
    };

    const handleSaveName = async (e) => {
        e.preventDefault();
        if (!editingName.trim()) return showNotification('Please enter a name.', 'error');
        if (!userId) return showNotification('User ID not ready. Please wait a moment.', 'error');
        
        try {
            await setDoc(doc(db, "users", userId), { name: editingName.trim() });
            showNotification('Name updated successfully!');
            setIsEditingName(false);
        } catch (error) {
            console.error("Error saving name:", error);
            showNotification('Could not save your name.', 'error');
        }
    };

    const handleCreateGroup = async (newGroupName) => {
        if (!newGroupName.trim()) return showNotification('Please enter a group name.', 'error');
        if (!userName) return showNotification('Please set your display name first.', 'error');

        try {
            const newGroupRef = doc(collection(db, "groups"));
            const batch = writeBatch(db);
            
            batch.set(newGroupRef, {
                groupName: newGroupName.trim(),
                creatorId: userId,
                createdAt: serverTimestamp()
            });

            const memberRef = doc(db, `groups/${newGroupRef.id}/members`, userId);
            batch.set(memberRef, {
                userName: userName,
                joinedAt: serverTimestamp()
            });

            await batch.commit();
            
            setCurrentGroupId(newGroupRef.id);
            setLastGroupId(newGroupRef.id);
            showNotification(`Group "${newGroupName}" created!`, 'success');
        } catch (error) {
            console.error("Error creating group:", error);
            showNotification('Could not create the group.', 'error');
        }
    };

    const handleJoinGroup = async (groupIdToJoin) => {
        if (!groupIdToJoin.trim()) return showNotification('Please enter a Group ID.', 'error');
        if (!userName) return showNotification('Please set your display name first.', 'error');

        try {
            const groupRef = doc(db, "groups", groupIdToJoin.trim());
            const groupSnap = await getDoc(groupRef);

            if (!groupSnap.exists()) {
                return showNotification('No group found with that ID.', 'error');
            }

            const memberRef = doc(db, `groups/${groupRef.id}/members`, userId);
            await setDoc(memberRef, {
                userName: userName,
                joinedAt: serverTimestamp()
            });

            setCurrentGroupId(groupRef.id);
            setLastGroupId(groupRef.id);
            showNotification(`Successfully joined "${groupSnap.data().groupName}"!`, 'success');
        } catch (error) {
            console.error("Error joining group:", error);
            showNotification('Could not join the group.', 'error');
        }
    };

    const handleLeaveGroup = () => {
        setCurrentGroupId(null);
        clearLastGroupId();
        showNotification("You have left the group.");
    };

    const handleSendCompliment = async (e) => {
        e.preventDefault();
        if (!selectedFriendId || !complimentMessage.trim()) {
            return showNotification('Please select a member and write a message.', 'error');
        }
        try {
            await addDoc(collection(db, "compliments"), {
                senderId: userId,
                receiverId: selectedFriendId,
                groupId: currentGroupId,
                message: complimentMessage,
                timestamp: serverTimestamp()
            });
            showNotification('Secret compliment sent!');
            setComplimentMessage('');
            setSelectedFriendId('');
        } catch (error) {
            console.error("Error sending compliment: ", error);
            showNotification('Could not send your compliment.', 'error');
        }
    };

    if (!isAuthReady) {
        return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white"><p>Loading Your Secret Space...</p></div>;
    }
    
    // --- Render Logic ---
    const renderContent = () => {
        if (!currentGroupId) {
            return <GroupGate 
                        onCreate={handleCreateGroup} 
                        onJoin={handleJoinGroup} 
                        userName={userName} 
                        isEditingName={isEditingName} 
                        editingName={editingName} 
                        setEditingName={setEditingName} 
                        onSaveName={handleSaveName}
                        onEditName={() => setIsEditingName(true)}
                    />;
        }

        return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Column 1: Group Info & Members */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-gray-800 p-5 rounded-xl shadow-lg">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-semibold text-purple-400 truncate pr-2">{groupName}</h2>
                            <button onClick={handleLeaveGroup} className="flex items-center gap-1 text-sm bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-lg transition"><LogOut size={14}/> Leave</button>
                        </div>
                        <label className="text-sm text-gray-400">Share this Group ID with friends</label>
                        <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm font-mono bg-gray-700 p-2 rounded flex-grow break-all">{currentGroupId}</p>
                            <button onClick={() => { navigator.clipboard.writeText(currentGroupId); showNotification('Group ID copied!'); }} className="p-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"><Clipboard size={18} /></button>
                        </div>
                    </div>
                    <div className="bg-gray-800 p-5 rounded-xl shadow-lg">
                        <h3 className="text-lg font-semibold mb-3">Group Members ({groupMembers.length})</h3>
                        <ul className="space-y-2 max-h-96 overflow-y-auto pr-2">
                            {groupMembers.map(member => (
                                <li key={member.id} className="bg-gray-700 p-2 rounded-lg text-sm font-bold text-gray-200">{member.userName}</li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Column 2: Send Compliment */}
                <div className="lg:col-span-1 bg-gray-800 p-5 rounded-xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-3 flex items-center gap-2"><Send className="text-pink-400"/>Send a Secret Compliment</h2>
                    <form onSubmit={handleSendCompliment} className="space-y-4">
                        <select value={selectedFriendId} onChange={(e) => setSelectedFriendId(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-pink-500 focus:outline-none transition">
                            <option value="" disabled>-- Select a Member --</option>
                            {groupMembers.filter(m => m.id !== userId).map(member => (
                                <option key={member.id} value={member.id}>{member.userName}</option>
                            ))}
                        </select>
                        <textarea rows="5" value={complimentMessage} onChange={(e) => setComplimentMessage(e.target.value)} placeholder="Write something kind..." className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-pink-500 focus:outline-none transition"></textarea>
                        <button type="submit" className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-orange-500 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition">Send Anonymously <Send size={18} /></button>
                    </form>
                </div>
                
                {/* Column 3: Compliment Lists */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-gray-800 p-5 rounded-xl shadow-lg">
                        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><Gift className="text-green-400"/>Compliments I've Received</h3>
                        <ul className="space-y-3 max-h-60 overflow-y-auto pr-2">
                           {receivedCompliments.length > 0 ? receivedCompliments.map(c => (
                               <li key={c.id} className="bg-gray-700 p-3 rounded-lg">
                                   <p className="text-gray-200">"{c.message}"</p>
                                   <p className="text-xs text-gray-500 text-right mt-1">- From a secret friend</p>
                               </li>
                           )) : <p className="text-gray-500 text-sm">Your secret compliments will appear here!</p>}
                        </ul>
                    </div>
                    <div className="bg-gray-800 p-5 rounded-xl shadow-lg">
                        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><ArrowRight className="text-blue-400"/>Compliments I've Sent</h3>
                        <ul className="space-y-3 max-h-60 overflow-y-auto pr-2">
                            {sentCompliments.length > 0 ? sentCompliments.map(c => (
                                <li key={c.id} className="bg-gray-700 p-3 rounded-lg">
                                    <p className="text-gray-200">"{c.message}"</p>
                                    <p className="text-xs text-blue-300 text-right mt-1">- You sent this to {memberMap.get(c.receiverId) || 'a member'}</p>
                                </li>
                            )) : <p className="text-gray-500 text-sm">Messages you send will be tracked here.</p>}
                        </ul>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="bg-gray-900 text-white min-h-screen font-sans p-4 sm:p-6 lg:p-8">
            {notification.show && <div className={`fixed top-5 right-5 px-4 py-2 rounded-lg shadow-lg text-white ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>{notification.message}</div>}
            <div className="max-w-7xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">Secret Compliments</h1>
                    <p className="text-gray-400 mt-2">Create or join a group to send anonymous kind messages.</p>
                </header>
                {renderContent()}
            </div>
        </div>
    );
}

// --- Component for Creating/Joining a Group ---
function GroupGate({ onCreate, onJoin, userName, isEditingName, editingName, setEditingName, onSaveName, onEditName }) {
    const [newGroupName, setNewGroupName] = useState('');
    const [groupIdToJoin, setGroupIdToJoin] = useState('');

    return (
        <div className="max-w-md mx-auto bg-gray-800 p-8 rounded-xl shadow-lg space-y-8">
            <div>
                <h2 className="text-2xl font-bold text-center text-white mb-2">Welcome!</h2>
                <p className="text-center text-gray-400">First, set your display name. This is how others in your group will see you.</p>
                 <div className="bg-gray-900 p-3 rounded-lg my-4">
                    <label className="text-sm text-gray-400">Your Display Name</label>
                    {isEditingName ? (
                        <form onSubmit={onSaveName} className="flex items-center gap-2 mt-1">
                            <input type="text" value={editingName} onChange={(e) => setEditingName(e.target.value)} placeholder="Enter your name" className="text-sm bg-gray-700 p-2 rounded flex-grow focus:ring-2 focus:ring-purple-500 focus:outline-none"/>
                            <button type="submit" className="p-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors" aria-label="Save Name"><Check size={18} /></button>
                        </form>
                    ) : (
                        <div className="flex items-center gap-2 mt-1">
                            <p className="text-lg bg-gray-700 p-2 rounded flex-grow font-semibold">{userName}</p>
                            <button onClick={onEditName} className="p-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors" aria-label="Edit Name"><Edit size={18} /></button>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Create Group */}
                <form onSubmit={(e) => { e.preventDefault(); onCreate(newGroupName); }} className="space-y-3">
                    <h3 className="text-lg font-semibold text-center flex items-center justify-center gap-2"><PlusSquare/> Create a Group</h3>
                    <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Enter new group name" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:outline-none transition"/>
                    <button type="submit" className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-indigo-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition">Create</button>
                </form>

                {/* Join Group */}
                <form onSubmit={(e) => { e.preventDefault(); onJoin(groupIdToJoin); }} className="space-y-3">
                    <h3 className="text-lg font-semibold text-center flex items-center justify-center gap-2"><LogIn/> Join a Group</h3>
                    <input type="text" value={groupIdToJoin} onChange={(e) => setGroupIdToJoin(e.target.value)} placeholder="Paste Group ID here" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-pink-500 focus:outline-none transition"/>
                    <button type="submit" className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-orange-500 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition">Join</button>
                </form>
            </div>
        </div>
    );
}
