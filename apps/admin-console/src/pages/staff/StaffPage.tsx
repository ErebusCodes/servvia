import { useState } from 'react';

// Mock data structures
interface StaffStatus {
  name: string;
  email: string;
  role: string;
  roleColor: string;
  venue: string;
  clockIn: string;
  status: 'Active' | 'On Break';
  statusColor: string;
  initials: string;
  avatarBg: string;
}

interface AlertNotification {
  title: string;
  subtext: string;
  iconBg: string;
  iconColor: string;
  icon: React.ReactNode;
}

interface ActivityItem {
  user: string;
  action: string;
  subtext: string;
  iconBg: string;
  iconColor: string;
  time: string;
  icon: React.ReactNode;
}

interface UpcomingShift {
  time: string;
  shiftName: string;
  dotBg: string;
  staffCount: string;
  avatars: string[];
}

const MOCK_WORKFORCE: StaffStatus[] = [
  {
    name: 'John Carter',
    email: 'john.carter@verdura.com',
    role: 'Kitchen Manager',
    roleColor: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    venue: 'Queen St. Branch',
    clockIn: '08:02 AM',
    status: 'Active',
    statusColor: 'text-emerald-600',
    initials: 'JC',
    avatarBg: 'bg-teal-100 text-teal-800',
  },
  {
    name: 'Sarah Mitchell',
    email: 'sarah.m@verdura.com',
    role: 'Shift Supervisor',
    roleColor: 'bg-blue-50 text-blue-700 border-blue-100',
    venue: 'Queen St. Branch',
    clockIn: '08:15 AM',
    status: 'Active',
    statusColor: 'text-emerald-600',
    initials: 'SM',
    avatarBg: 'bg-indigo-100 text-indigo-800',
  },
  {
    name: 'Michael Chen',
    email: 'michael.c@verdura.com',
    role: 'Chef',
    roleColor: 'bg-purple-50 text-purple-700 border-purple-100',
    venue: 'Airport Branch',
    clockIn: '07:45 AM',
    status: 'Active',
    statusColor: 'text-emerald-600',
    initials: 'MC',
    avatarBg: 'bg-purple-100 text-purple-800',
  },
  {
    name: 'Emma Williams',
    email: 'emma.w@verdura.com',
    role: 'Barista',
    roleColor: 'bg-amber-50 text-amber-700 border-amber-100',
    venue: 'Queen St. Branch',
    clockIn: '08:10 AM',
    status: 'On Break',
    statusColor: 'text-orange-500',
    initials: 'EW',
    avatarBg: 'bg-orange-100 text-orange-800',
  },
  {
    name: 'James Thompson',
    email: 'james.t@verdura.com',
    role: 'Waiter',
    roleColor: 'bg-gray-50 text-gray-700 border-gray-200',
    venue: 'City Branch',
    clockIn: '08:20 AM',
    status: 'Active',
    statusColor: 'text-emerald-600',
    initials: 'JT',
    avatarBg: 'bg-pink-100 text-pink-800',
  },
];

export function StaffPage() {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'employees', label: 'Employees' },
    { id: 'roles', label: 'Roles & Permissions' },
    { id: 'scheduling', label: 'Scheduling' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'activity', label: 'Activity Log' },
    { id: 'venues', label: 'Venues Assignment' },
    { id: 'documents', label: 'Documents' },
  ];

  const stats = [
    {
      title: 'Total Staff',
      value: '128',
      subtext: '↑ 12 this month',
      subtextColor: 'text-emerald-600',
      iconBg: 'bg-emerald-50 border-emerald-100',
      iconColor: 'text-emerald-600',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      title: 'Active Today',
      value: '98',
      subtext: '76.6% of total',
      subtextColor: 'text-blue-500',
      iconBg: 'bg-blue-50 border-blue-100',
      iconColor: 'text-blue-500',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      title: 'On Shift Now',
      value: '42',
      subtext: '5 venues',
      subtextColor: 'text-purple-600',
      iconBg: 'bg-purple-50 border-purple-100',
      iconColor: 'text-purple-600',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: 'Clocked In Late',
      value: '6',
      subtext: '14.3% of today',
      subtextColor: 'text-orange-500',
      iconBg: 'bg-orange-50 border-orange-100',
      iconColor: 'text-orange-500',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
    {
      title: 'Unassigned Staff',
      value: '4',
      subtext: 'Action required',
      subtextColor: 'text-red-500',
      iconBg: 'bg-red-50 border-red-100',
      iconColor: 'text-red-500',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      ),
    },
    {
      title: 'Pending Role Approvals',
      value: '3',
      subtext: 'Review now',
      subtextColor: 'text-yellow-600',
      iconBg: 'bg-yellow-50 border-yellow-100',
      iconColor: 'text-yellow-600',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
  ];

  const alerts: AlertNotification[] = [
    {
      title: '3 staff members missed clock-in',
      subtext: 'Queen St. Branch • 09:00 AM',
      iconBg: 'bg-red-50 text-red-500 border border-red-100',
      iconColor: 'text-red-500',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
    {
      title: '2 shift conflicts detected',
      subtext: 'Airport Branch • Today',
      iconBg: 'bg-orange-50 text-orange-500 border border-orange-100',
      iconColor: 'text-orange-500',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: '4 unassigned shifts',
      subtext: 'City Branch • Tomorrow',
      iconBg: 'bg-yellow-50 text-yellow-600 border border-yellow-100',
      iconColor: 'text-yellow-600',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75" />
        </svg>
      ),
    },
    {
      title: '2 role approval pending',
      subtext: 'Requires admin review',
      iconBg: 'bg-blue-50 text-blue-500 border border-blue-100',
      iconColor: 'text-blue-500',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622" />
        </svg>
      ),
    },
  ];

  const activities: ActivityItem[] = [
    {
      user: 'John Carter',
      action: 'clocked in',
      subtext: 'Queen St. Branch • Kitchen',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      time: '08:02 AM',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    {
      user: 'Sarah Mitchell',
      action: 'changed shift assignment',
      subtext: 'From Table Service to Bar • Queen St. Branch',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      time: '07:58 AM',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5A7.5 7.5 0 0024 9" />
        </svg>
      ),
    },
    {
      user: 'Admin',
      action: 'updated role permissions',
      subtext: 'Michael Chen • Chef',
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
      time: '07:45 AM',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      ),
    },
    {
      user: 'Emma Williams',
      action: 'started break',
      subtext: 'Queen St. Branch • Barista',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      time: '11:15 AM',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      ),
    },
    {
      user: 'New staff member added',
      action: '',
      subtext: 'David Wilson • Waiter • Airport Branch',
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
      time: '10:30 AM',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      ),
    },
  ];

  const schedules: UpcomingShift[] = [
    {
      time: '09:00 AM – 05:00 PM',
      shiftName: 'Morning Shift',
      dotBg: 'bg-emerald-500',
      staffCount: '18',
      avatars: ['JC', 'SM', 'MC'],
    },
    {
      time: '01:00 PM – 09:00 PM',
      shiftName: 'Afternoon Shift',
      dotBg: 'bg-blue-500',
      staffCount: '16',
      avatars: ['EW', 'JT', 'JC'],
    },
    {
      time: '05:00 PM – 01:00 AM',
      shiftName: 'Evening Shift',
      dotBg: 'bg-purple-500',
      staffCount: '14',
      avatars: ['MC', 'SM', 'EW'],
    },
    {
      time: '09:00 PM – 05:00 AM',
      shiftName: 'Night Shift',
      dotBg: 'bg-orange-500',
      staffCount: '8',
      avatars: ['JT', 'JC', 'SM'],
    },
  ];

  const getAvatarColor = (initials: string) => {
    const code = initials.charCodeAt(0) + (initials.charCodeAt(1) || 0);
    const colors = [
      'bg-teal-100 text-teal-800',
      'bg-indigo-100 text-indigo-800',
      'bg-purple-100 text-purple-800',
      'bg-pink-100 text-pink-800',
      'bg-amber-100 text-amber-800',
      'bg-blue-100 text-blue-800',
    ];
    return colors[code % colors.length];
  };

  const quickActions = [
    {
      title: 'Add Staff Member',
      subtext: 'Invite new team member',
      iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235A8.902 8.902 0 0110.25 15c2.196 0 4.2.788 5.75 2.1a8.91 8.91 0 013.447 5.566c.02.106-.053.22-.162.22H3.75c-.09 0-.164-.078-.145-.167a8.93 8.93 0 01.395-2.928z" />
        </svg>
      ),
    },
    {
      title: 'Create Role',
      subtext: 'Define custom role',
      iconBg: 'bg-blue-50 text-blue-500 border border-blue-100',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H3.75v-2.25A13.5 13.5 0 0015.75 5.25z" />
        </svg>
      ),
    },
    {
      title: 'Create Schedule',
      subtext: 'Plan staff shifts',
      iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
      ),
    },
    {
      title: 'Bulk Assign Venue',
      subtext: 'Assign to venues',
      iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3.545L12 9M6.75 9h10.5" />
        </svg>
      ),
    },
    {
      title: 'Import Staff',
      subtext: 'Upload from file',
      iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5h10.5a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="px-6 py-5 flex flex-col gap-5 select-none bg-gray-50/50">
      
      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-200 -mx-6 px-6">
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap scrollbar-none">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-3 px-4 text-[13px] font-semibold border-b-2 transition-colors relative -mb-[1px] ${
                  isActive
                    ? 'border-emerald-600 text-emerald-600 font-semibold'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((card, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm flex items-center gap-3.5 h-[80px] hover:border-gray-300 transition-colors">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${card.iconBg} ${card.iconColor}`}>
              {card.icon}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-semibold text-gray-500 leading-none truncate">{card.title}</span>
              <span className="text-xl font-bold text-gray-900 leading-tight mt-1 tabular-nums">{card.value}</span>
              <span className={`text-[10px] font-bold mt-0.5 leading-none ${card.subtextColor}`}>{card.subtext}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 2-Column Section Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* Left Column (Spans 2 cols) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          
          {/* Panel 1: Live Workforce Status */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-gray-900 text-sm">Live Workforce Status</h3>
              <button className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-xs">
                <span>View all</span>
                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[500px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="py-2.5 pl-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Staff Member</th>
                    <th className="py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Role</th>
                    <th className="py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Venue</th>
                    <th className="py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Clock In</th>
                    <th className="py-2.5 pr-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_WORKFORCE.map((staff, idx) => (
                    <tr key={idx} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30 transition-colors">
                      <td className="py-3 pl-4 flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${staff.avatarBg}`}>
                          {staff.initials}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-gray-900 leading-tight truncate">{staff.name}</span>
                          <span className="text-xs text-gray-500 leading-tight truncate">{staff.email}</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${staff.roleColor}`}>
                          {staff.role}
                        </span>
                      </td>
                      <td className="py-3 text-sm text-gray-900 font-medium">{staff.venue}</td>
                      <td className="py-3 text-sm text-gray-900 font-medium">{staff.clockIn}</td>
                      <td className="py-3 pr-4 text-sm font-medium">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full bg-current ${staff.statusColor}`} />
                          <span className={staff.statusColor}>{staff.status}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="flex justify-center py-3 border-t border-gray-100">
              <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-xs">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
                </svg>
                View full attendance
              </button>
            </div>
          </div>

          {/* Panel 3: Activity Stream */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-gray-900 text-sm">Activity Stream</h3>
              <button className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-xs">
                <span>View all</span>
                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            
            <div className="flex flex-col">
              {activities.map((act, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/20 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${act.iconBg} ${act.iconColor}`}>
                      {act.icon}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-gray-900 leading-tight">
                        <span className="font-semibold">{act.user}</span>{' '}
                        <span className="text-gray-500">{act.action}</span>
                      </span>
                      <span className="text-xs text-gray-400 mt-0.5 leading-tight">{act.subtext}</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-gray-400 tabular-nums">{act.time}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column (Spans 1 col) */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          
          {/* Panel 2: Alerts & Notifications */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-gray-900 text-sm">Alerts & Notifications</h3>
              <button className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-xs">
                <span>View all</span>
              </button>
            </div>
            
            <div className="flex flex-col">
              {alerts.map((alert, i) => (
                <div key={i} className="flex items-center justify-between p-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/30 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${alert.iconBg} ${alert.iconColor}`}>
                      {alert.icon}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900 leading-tight truncate">{alert.title}</h4>
                      <p className="text-xs text-gray-500 leading-tight mt-0.5 truncate">{alert.subtext}</p>
                    </div>
                  </div>
                  <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-colors shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              ))}
            </div>
          </div>

          {/* Panel 4: Upcoming Schedule (Today) */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-gray-900 text-sm">Upcoming Schedule (Today)</h3>
              <button className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-xs">
                <span>View full schedule</span>
              </button>
            </div>
            
            <div className="flex flex-col">
              {schedules.map((sched, i) => (
                <div key={i} className="flex items-center justify-between p-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/20 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sched.dotBg}`} />
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-gray-900 leading-tight">{sched.time}</h4>
                      <p className="text-xs text-gray-500 leading-tight mt-0.5">{sched.shiftName}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 shrink-0">
                    {/* Overlapping Avatars */}
                    <div className="flex -space-x-1.5 overflow-hidden">
                      {sched.avatars.map((av, aIdx) => (
                        <div
                          key={aIdx}
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ring-2 ring-white ${getAvatarColor(av)}`}
                        >
                          {av}
                        </div>
                      ))}
                    </div>
                    
                    {/* Staff count indicator */}
                    <div className="text-right">
                      <div className="text-sm font-extrabold text-gray-900 leading-none">{sched.staffCount}</div>
                      <div className="text-[9px] font-bold text-gray-400 uppercase mt-0.5 leading-none">Staff</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

      {/* Bottom Section: Quick Actions */}
      <div className="flex flex-col gap-2 mt-2">
        <h3 className="font-bold text-gray-950 text-base">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {quickActions.map((action, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm flex items-center gap-3.5 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer group">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${action.iconBg}`}>
                {action.icon}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-gray-900 leading-tight group-hover:text-emerald-700 transition-colors truncate">{action.title}</span>
                <span className="text-xs text-gray-500 leading-tight mt-0.5 truncate">{action.subtext}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
