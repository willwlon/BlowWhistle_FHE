import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface WhistleblowerData {
  id: string;
  title: string;
  category: string;
  encryptedEvidence: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<WhistleblowerData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newReportData, setNewReportData] = useState({ 
    title: "", 
    category: "corruption", 
    evidence: "", 
    description: "" 
  });
  const [selectedReport, setSelectedReport] = useState<WhistleblowerData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [stats, setStats] = useState({ total: 0, verified: 0, pending: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadReports();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadReports = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const reportsList: WhistleblowerData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          reportsList.push({
            id: businessId,
            title: businessData.name,
            category: "whistleblower",
            encryptedEvidence: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading report data:', e);
        }
      }
      
      setReports(reportsList);
      updateStats(reportsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load reports" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (reportsList: WhistleblowerData[]) => {
    const total = reportsList.length;
    const verified = reportsList.filter(r => r.isVerified).length;
    const pending = total - verified;
    setStats({ total, verified, pending });
  };

  const createReport = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingReport(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted report..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const evidenceValue = parseInt(newReportData.evidence) || 0;
      const businessId = `report-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, evidenceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newReportData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newReportData.category === "corruption" ? 1 : 0,
        newReportData.category === "safety" ? 1 : 0,
        newReportData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Report submitted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadReports();
      setShowCreateModal(false);
      setNewReportData({ title: "", category: "corruption", evidence: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingReport(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadReports();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadReports();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "System is available and ready" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Availability check failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredReports = reports.filter(report => {
    const matchesSearch = report.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         report.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || 
                           (filterCategory === "corruption" && report.publicValue1 === 1) ||
                           (filterCategory === "safety" && report.publicValue2 === 1);
    return matchesSearch && matchesCategory;
  });

  const renderStats = () => (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-value">{stats.total}</div>
        <div className="stat-label">Total Reports</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.verified}</div>
        <div className="stat-label">Verified</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.pending}</div>
        <div className="stat-label">Pending Review</div>
      </div>
    </div>
  );

  const renderFHEProcess = () => (
    <div className="fhe-process">
      <div className="process-step">
        <div className="step-number">1</div>
        <div className="step-content">
          <h4>Encrypt Evidence</h4>
          <p>Evidence is encrypted using FHE before submission</p>
        </div>
      </div>
      <div className="process-step">
        <div className="step-number">2</div>
        <div className="step-content">
          <h4>Multi-party Storage</h4>
          <p>Encrypted data requires multiple keys to decrypt</p>
        </div>
      </div>
      <div className="process-step">
        <div className="step-number">3</div>
        <div className="step-content">
          <h4>Secure Verification</h4>
          <p>Decryption proofs are verified on-chain</p>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>🔒 Confidential Whistleblower</h1>
            <p>FHE-Protected Reporting System</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <h2>Secure Anonymous Reporting</h2>
            <p>Connect your wallet to submit encrypted evidence with full anonymity protection</p>
            <div className="security-features">
              <div className="feature">🔐 End-to-End Encryption</div>
              <div className="feature">🕵️ Complete Anonymity</div>
              <div className="feature">🔑 Multi-party Decryption</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="encryption-spinner"></div>
        <p>Initializing FHE Security System...</p>
        <p className="loading-note">Setting up encrypted environment</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="encryption-spinner"></div>
      <p>Loading secure reporting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>🔒 Confidential Whistleblower</h1>
          <p>FHE-Protected Reporting System</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="system-check">
            System Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="report-btn">
            + New Report
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>Reporting Dashboard</h2>
            <button onClick={loadReports} disabled={isRefreshing} className="refresh-btn">
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          {renderStats()}
          
          <div className="security-overview">
            <h3>FHE Security Process</h3>
            {renderFHEProcess()}
          </div>
        </section>

        <section className="reports-section">
          <div className="controls-row">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search reports..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select 
              value={filterCategory} 
              onChange={(e) => setFilterCategory(e.target.value)}
              className="category-filter"
            >
              <option value="all">All Categories</option>
              <option value="corruption">Corruption</option>
              <option value="safety">Safety Violation</option>
            </select>
          </div>

          <div className="reports-list">
            {filteredReports.length === 0 ? (
              <div className="empty-state">
                <p>No reports found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-first-btn">
                  Create First Report
                </button>
              </div>
            ) : (
              filteredReports.map((report) => (
                <div 
                  key={report.id} 
                  className={`report-card ${report.isVerified ? 'verified' : 'pending'}`}
                  onClick={() => setSelectedReport(report)}
                >
                  <div className="report-header">
                    <h3>{report.title}</h3>
                    <span className={`status-badge ${report.isVerified ? 'verified' : 'pending'}`}>
                      {report.isVerified ? '✅ Verified' : '⏳ Pending'}
                    </span>
                  </div>
                  <p className="report-desc">{report.description}</p>
                  <div className="report-meta">
                    <span>Category: {report.publicValue1 === 1 ? 'Corruption' : 'Safety'}</span>
                    <span>{new Date(report.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <CreateReportModal
          onSubmit={createReport}
          onClose={() => setShowCreateModal(false)}
          creating={creatingReport}
          reportData={newReportData}
          setReportData={setNewReportData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedReport && (
        <ReportDetailModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          onDecrypt={() => decryptData(selectedReport.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const CreateReportModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  reportData: any;
  setReportData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, reportData, setReportData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setReportData({ ...reportData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Submit Encrypted Report</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <strong>🔐 FHE Encryption Active</strong>
            <p>All evidence will be encrypted using fully homomorphic encryption</p>
          </div>

          <div className="form-group">
            <label>Report Title *</label>
            <input
              type="text"
              name="title"
              value={reportData.title}
              onChange={handleChange}
              placeholder="Enter report title..."
            />
          </div>

          <div className="form-group">
            <label>Category *</label>
            <select name="category" value={reportData.category} onChange={handleChange}>
              <option value="corruption">Corruption</option>
              <option value="safety">Safety Violation</option>
            </select>
          </div>

          <div className="form-group">
            <label>Evidence Value (Integer) *</label>
            <input
              type="number"
              name="evidence"
              value={reportData.evidence}
              onChange={handleChange}
              placeholder="Enter evidence value..."
              min="0"
              step="1"
            />
            <div className="field-note">FHE Encrypted Integer</div>
          </div>

          <div className="form-group">
            <label>Description *</label>
            <textarea
              name="description"
              value={reportData.description}
              onChange={handleChange}
              placeholder="Describe the incident..."
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !reportData.title || !reportData.evidence || !reportData.description}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Submit Report"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ReportDetailModal: React.FC<{
  report: WhistleblowerData;
  onClose: () => void;
  onDecrypt: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ report, onClose, onDecrypt, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (report.isVerified) return;
    const result = await onDecrypt();
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Report Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="modal-body">
          <div className="report-info">
            <div className="info-row">
              <span>Title:</span>
              <strong>{report.title}</strong>
            </div>
            <div className="info-row">
              <span>Category:</span>
              <span>{report.publicValue1 === 1 ? 'Corruption' : 'Safety Violation'}</span>
            </div>
            <div className="info-row">
              <span>Submitted:</span>
              <span>{new Date(report.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <span className={`status ${report.isVerified ? 'verified' : 'pending'}`}>
                {report.isVerified ? '✅ Verified' : '⏳ Pending Verification'}
              </span>
            </div>
          </div>

          <div className="description-section">
            <h4>Description</h4>
            <p>{report.description}</p>
          </div>

          <div className="evidence-section">
            <h4>Encrypted Evidence</h4>
            <div className="evidence-status">
              {report.isVerified ? (
                <div className="verified-evidence">
                  <strong>Decrypted Value: {report.decryptedValue}</strong>
                  <span className="badge">On-chain Verified</span>
                </div>
              ) : localDecrypted !== null ? (
                <div className="local-decrypted">
                  <strong>Decrypted Value: {localDecrypted}</strong>
                  <span className="badge">Locally Decrypted</span>
                </div>
              ) : (
                <div className="encrypted-evidence">
                  <span>🔒 Evidence is encrypted</span>
                  <span className="badge">FHE Protected</span>
                </div>
              )}
            </div>

            {!report.isVerified && (
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting}
                className="decrypt-btn"
              >
                {isDecrypting ? "Verifying..." : "Verify Evidence"}
              </button>
            )}
          </div>

          <div className="security-info">
            <h4>🔐 Security Information</h4>
            <p>This evidence is protected by FHE encryption and requires multi-party cooperation for decryption.</p>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;