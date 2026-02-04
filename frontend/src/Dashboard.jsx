import React, { useState } from 'react';

// Layout components
import { Header, Navigation, SlidePanel } from './components/layout';

// Summary components
import { StatusBar, AgencyCard, AlertSection } from './components/summary';

// Agency detail components
import { CJIADetail, GWIDetail, GPLDetail, GCAADetail } from './components/agencies';

// Common components
import { LoadingSkeleton } from './components/common';

// Hooks
import { useAgencyData } from './hooks/useAgencyData';

// Agency detail component map
const DETAIL_COMPONENTS = {
  cjia: CJIADetail,
  gwi: GWIDetail,
  gpl: GPLDetail,
  gcaa: GCAADetail,
};

export default function MinistryDashboard() {
  const [activeView, setActiveView] = useState('summary');
  const [selectedAgency, setSelectedAgency] = useState(null);
  const { agencies, alerts, rawData, lastUpdated, isLoading, refresh } = useAgencyData();

  // Handle agency card click
  const handleAgencyClick = (agency) => {
    setSelectedAgency(agency);
  };

  // Handle alert action (navigate to agency)
  const handleAlertAction = (alert) => {
    const agency = agencies.find(a => a.id === alert.agency);
    if (agency) {
      setSelectedAgency(agency);
    }
  };

  // Close slide panel
  const handleClosePanel = () => {
    setSelectedAgency(null);
  };

  // Get detail component for selected agency
  const DetailComponent = selectedAgency ? DETAIL_COMPONENTS[selectedAgency.id] : null;

  // Sort agencies - critical first, then warning, then good
  const sortedAgencies = [...agencies].sort((a, b) => {
    const priority = { critical: 0, warning: 1, good: 2 };
    return (priority[a.status?.type] || 2) - (priority[b.status?.type] || 2);
  });

  return (
    <div className="min-h-screen bg-[#0f1729]">
      {/* Google Font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        * { font-family: 'Plus Jakarta Sans', sans-serif; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Header */}
      <Header
        lastUpdated={lastUpdated}
        isRefreshing={isLoading}
        onRefresh={refresh}
      />

      {/* Navigation */}
      <Navigation
        agencies={agencies}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {isLoading ? (
          <div className="space-y-6">
            <LoadingSkeleton type="statusBar" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <LoadingSkeleton type="card" count={4} />
            </div>
          </div>
        ) : activeView === 'summary' ? (
          <div className="space-y-6">
            {/* Status Bar */}
            <StatusBar agencies={agencies} />

            {/* Alerts */}
            {alerts.length > 0 && (
              <AlertSection
                alerts={alerts}
                onAlertAction={handleAlertAction}
              />
            )}

            {/* Agency Cards Grid */}
            <div>
              <h3 className="text-slate-400 text-sm font-medium mb-4">Agency Overview</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {sortedAgencies.map(agency => (
                  <AgencyCard
                    key={agency.id}
                    agency={agency}
                    onClick={() => handleAgencyClick(agency)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          // Direct agency view (from nav)
          <div className="space-y-6">
            {activeView === 'cjia' && <CJIADetail data={rawData.cjia} />}
            {activeView === 'gwi' && <GWIDetail data={rawData.gwi} />}
            {activeView === 'gpl' && <GPLDetail data={rawData.gpl} />}
            {activeView === 'gcaa' && <GCAADetail data={rawData.gcaa} />}
          </div>
        )}
      </main>

      {/* Slide Panel for Agency Details */}
      <SlidePanel
        isOpen={!!selectedAgency}
        onClose={handleClosePanel}
        title={selectedAgency?.title}
        subtitle={selectedAgency?.subtitle}
        icon={selectedAgency?.icon}
        accentColor={selectedAgency?.accentColor}
      >
        {DetailComponent && <DetailComponent data={rawData[selectedAgency.id]} />}
      </SlidePanel>

      {/* Footer */}
      <footer className="border-t border-[#243049] mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <p className="text-[#64748b] text-sm text-center">
            Ministry of Public Utilities and Aviation • Government of Guyana • Dashboard v2.0
          </p>
        </div>
      </footer>
    </div>
  );
}
