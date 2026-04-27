// --- SUPABASE CONFIGURATION ---
// IMPORTANT: Add your Supabase URL and Anon Key here
const SUPABASE_URL = 'https://tgmxpawrrsxphsmsqfyz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkcnhxb2hqcXBvcXJ0dnlhaW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyOTYxMTIsImV4cCI6MjA1ODg3MjExMn0.sW2K-rC3x84lCqg9uO7T_82eWbY6zYhH1O7L6Z3x8_Q';

let supabaseClient = null;
try {
    if (SUPABASE_URL && SUPABASE_URL.startsWith('http')) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch (e) {
    console.error("Supabase init failed:", e);
}

// --- STATE MANAGEMENT ---
let currentUser = null;
let currentProfile = null; // Contains role and employee details
let map = null;
let markers = {}; // Store Leaflet markers by engineerId
let geoWatchId = null;
let locationInterval = null;
let allComplaints = []; // Store fetched complaints for filtering

// --- DOM ELEMENTS ---
const loginView = document.getElementById('login-view');
const appLayout = document.getElementById('app-layout');
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');

// Sidebar
const navAdmin = document.getElementById('nav-admin');
const navEngineer = document.getElementById('nav-engineer');
const navItems = document.querySelectorAll('.nav-item');
const sidebarUserName = document.getElementById('sidebar-user-name');
const sidebarUserRole = document.getElementById('sidebar-user-role');

// Sections
const sections = document.querySelectorAll('.dashboard-section');
const adminComplaintsList = document.getElementById('admin-complaints-list');
const engineerComplaintsList = document.getElementById('engineer-complaints-list');
const createComplaintForm = document.getElementById('create-complaint-form');
const engineerSelect = document.getElementById('c-engineer');

// --- UTILITIES ---
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} active`;
    setTimeout(() => { toast.classList.remove('active'); toast.classList.add('hidden'); }, 3000);
}

function switchSection(targetId) {
    sections.forEach(sec => sec.classList.add('hidden'));
    document.getElementById(targetId).classList.remove('hidden');
    navItems.forEach(item => item.classList.remove('active'));
    document.querySelector(`[data-target="${targetId}"]`).classList.add('active');

    if (targetId === 'admin-map' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

// Sidebar Navigation
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        switchSection(item.getAttribute('data-target'));
    });
});

// --- AUTHENTICATION ---
if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            handleLogin(session.user);
        } else {
            handleLogout();
        }
    });
} else {
    showToast("Supabase keys missing. App will not function correctly.", "error");
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('login-btn');

    btn.innerHTML = 'Signing in...';
    btn.disabled = true;

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange will trigger handleLogin
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        btn.innerHTML = 'Sign In <i class="fa-solid fa-arrow-right"></i>';
        btn.disabled = false;
    }
});

logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
});

async function handleLogin(user) {
    currentUser = user;

    // Fetch user profile/role
    const { data, error } = await supabaseClient.from('engineers').select('*').eq('id', user.id).single();

    if (error) {
        console.error(error);
        showToast("Could not load user profile", "error");
        return;
    }

    currentProfile = data;

    // Update UI
    loginView.classList.add('hidden');
    appLayout.classList.remove('hidden');
    sidebarUserName.textContent = currentProfile.name;
    sidebarUserRole.textContent = currentProfile.role.toUpperCase();

    if (currentProfile.role === 'admin') {
        navAdmin.classList.remove('hidden');
        navEngineer.classList.add('hidden');
        initAdmin();
        switchSection('admin-complaints');
    } else {
        navEngineer.classList.remove('hidden');
        navAdmin.classList.add('hidden');
        initEngineer();
        switchSection('engineer-complaints');
    }
}

function handleLogout() {
    currentUser = null;
    currentProfile = null;
    appLayout.classList.add('hidden');
    loginView.classList.remove('hidden');

    // Stop tracking
    if (geoWatchId) navigator.geolocation.clearWatch(geoWatchId);
    if (locationInterval) clearInterval(locationInterval);
}

// --- ADMIN LOGIC ---
async function initAdmin() {
    loadComplaints();
    loadEngineersForDropdown();
    initMap();
    subscribeToData();

    document.getElementById('btn-new-complaint').addEventListener('click', () => {
        document.getElementById('create-complaint-panel').classList.remove('hidden');
    });

    document.getElementById('btn-cancel-complaint').addEventListener('click', () => {
        document.getElementById('create-complaint-panel').classList.add('hidden');
    });
}

async function loadEngineersForDropdown() {
    const { data, error } = await supabaseClient.from('engineers').select('*').eq('role', 'engineer');
    if (error) return;

    engineerSelect.innerHTML = '<option value="">Select Engineer</option>';
    data.forEach(eng => {
        engineerSelect.innerHTML += `<option value="${eng.id}">${eng.name} (${eng.employeeId})</option>`;
    });
}

createComplaintForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = createComplaintForm.querySelector('button[type="submit"]');
    btn.disabled = true;

    const newComplaint = {
        ticketId: 'TKT-' + Math.floor(Math.random() * 10000),
        customerName: document.getElementById('c-customer').value,
        issue: document.getElementById('c-issue').value,
        priority: document.getElementById('c-priority').value,
        assignedEngineer: document.getElementById('c-engineer').value,
        status: 'Assigned'
    };

    try {
        const { error } = await supabaseClient.from('complaints').insert([newComplaint]);
        if (error) throw error;

        showToast("Complaint dispatched successfully");
        createComplaintForm.reset();
        document.getElementById('create-complaint-panel').classList.add('hidden');
        loadComplaints(); // Refresh list
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        btn.disabled = false;
    }
});

async function loadComplaints() {
    const { data: complaints, error } = await supabaseClient
        .from('complaints')
        .select(`*, engineers(name)`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    allComplaints = complaints;
    renderComplaints();
}

function renderComplaints() {
    const searchQuery = document.getElementById('search-complaints').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status').value;

    adminComplaintsList.innerHTML = '';

    const filteredComplaints = allComplaints.filter(c => {
        const matchesSearch = c.ticketId.toLowerCase().includes(searchQuery) || c.customerName.toLowerCase().includes(searchQuery);
        const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    if (filteredComplaints.length === 0) {
        adminComplaintsList.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding: 2rem;">No complaints found.</td></tr>';
        return;
    }

    filteredComplaints.forEach(c => {
        const statusClass = c.status === 'Completed' ? 'status-completed' : (c.status === 'In Progress' ? 'status-in-progress' : 'status-assigned');
        const engName = c.engineers ? c.engineers.name : 'Unknown';

        adminComplaintsList.innerHTML += `
            <tr>
                <td><strong>${c.ticketId}</strong></td>
                <td>${c.customerName}</td>
                <td>${c.issue}</td>
                <td>${c.priority}</td>
                <td>${engName}</td>
                <td><span class="status-pill ${statusClass}">${c.status}</span></td>
            </tr>
        `;
    });
}

// Add event listeners for Search and Filter
document.getElementById('search-complaints').addEventListener('input', renderComplaints);
document.getElementById('filter-status').addEventListener('change', renderComplaints);

// --- MAP & TRACKING LOGIC ---
function initMap() {
    if (!map) {
        map = L.map('map').setView([20.5937, 78.9629], 5); // Center on India
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }
    loadEngineerLocations();
}

async function loadEngineerLocations() {
    const { data, error } = await supabaseClient.from('engineer_tracking').select('*, engineers(name)');
    if (error) return;

    data.forEach(loc => updateMarker(loc));
}

function updateMarker(locationData) {
    if (!map || !locationData.latitude || !locationData.longitude) return;

    const { engineerId, latitude, longitude, engineers } = locationData;
    const name = engineers ? engineers.name : 'Engineer';

    if (markers[engineerId]) {
        markers[engineerId].setLatLng([latitude, longitude]);
    } else {
        const marker = L.marker([latitude, longitude]).addTo(map);
        marker.bindPopup(`<b>${name}</b><br>Last updated: ${new Date().toLocaleTimeString()}`);
        markers[engineerId] = marker;
    }
}

// Supabase Realtime
function subscribeToData() {
    // Listen for new complaints
    supabaseClient.channel('public:complaints').on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, payload => {
        loadComplaints();
    }).subscribe();

    // Listen for location updates
    supabaseClient.channel('public:engineer_tracking').on('postgres_changes', { event: '*', schema: 'public', table: 'engineer_tracking' }, async payload => {
        // Fetch engineer name to update marker properly
        const { data } = await supabaseClient.from('engineers').select('name').eq('id', payload.new.engineerId).single();
        if (data) {
            payload.new.engineers = data;
            updateMarker(payload.new);
        }
    }).subscribe();
}


// --- ENGINEER LOGIC ---
async function initEngineer() {
    const now = new Date();
    document.getElementById('session-time').textContent = now.toLocaleTimeString();

    // Log login time to tracking table
    await supabaseClient.from('engineer_tracking').upsert({
        engineerId: currentUser.id,
        loginTime: now.toISOString(),
        status: 'online'
    });

    loadEngineerJobs();
    startLocationTracking();

    // Listen for my job updates
    supabaseClient.channel('engineer_jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'complaints', filter: `assignedEngineer=eq.${currentUser.id}` }, payload => {
        loadEngineerJobs();
    }).subscribe();
}

async function loadEngineerJobs() {
    const { data: jobs, error } = await supabaseClient
        .from('complaints')
        .select('*')
        .eq('assignedEngineer', currentUser.id)
        .order('created_at', { ascending: false });

    if (error) return;

    engineerComplaintsList.innerHTML = '';

    if (jobs.length === 0) {
        engineerComplaintsList.innerHTML = '<p class="text-muted">No jobs assigned yet.</p>';
        return;
    }

    jobs.forEach(job => {
        let actionBtn = '';
        if (job.status === 'Assigned') {
            actionBtn = `<button class="btn btn-primary btn-block" onclick="updateJobStatus('${job.ticketId}', 'In Progress')">Start Job (In Progress)</button>`;
        } else if (job.status === 'In Progress') {
            actionBtn = `<button class="btn btn-outline btn-block" style="background:#10b981; color:white; border-color:#10b981;" onclick="updateJobStatus('${job.ticketId}', 'Completed')">Mark Completed</button>`;
        }

        engineerComplaintsList.innerHTML += `
            <div class="job-card">
                <div class="job-card-header">
                    <span class="job-id">${job.ticketId}</span>
                    <span class="badge ${job.priority === 'Critical' ? 'badge-warning' : 'badge-success'}">${job.priority}</span>
                </div>
                <div class="job-title">${job.issue}</div>
                <div class="job-detail"><i class="fa-solid fa-user"></i> ${job.customerName}</div>
                <div class="job-detail"><i class="fa-solid fa-circle-info"></i> Status: <strong>${job.status}</strong></div>
                <div class="job-actions">
                    ${actionBtn}
                </div>
            </div>
        `;
    });
}

window.updateJobStatus = async function (ticketId, newStatus) {
    try {
        const { error } = await supabaseClient.from('complaints').update({ status: newStatus }).eq('ticketId', ticketId);
        if (error) throw error;
        showToast("Status updated successfully");
        loadEngineerJobs(); // Optimistic refresh
    } catch (e) {
        showToast(e.message, "error");
    }
}

// Geolocation Tracking
function startLocationTracking() {
    if (!navigator.geolocation) {
        showToast("Geolocation is not supported by your browser", "error");
        return;
    }

    // Update location every 30 seconds
    const updateLocation = () => {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const { latitude, longitude } = position.coords;
            try {
                await supabaseClient.from('engineer_tracking').upsert({
                    engineerId: currentUser.id,
                    latitude: latitude,
                    longitude: longitude,
                    status: 'online'
                });
            } catch (e) {
                console.error("Failed to update location", e);
            }
        }, (error) => {
            console.error("Geolocation error:", error.message);
        });
    };

    updateLocation(); // Initial call
    locationInterval = setInterval(updateLocation, 30000);
}
