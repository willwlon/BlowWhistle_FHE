import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface WhistleblowerReport {
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

interface ReportStats {
  totalReports: number;
  verifiedReports: number;
  pendingReports: number;
  averageRisk: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<WhistleblowerReport[]>([]);
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
    evidenceValue: "",
    riskLevel: "5",
    description: "" 
  });
  const [selectedReport, setSelectedReport] = useState<WhistleblowerReport | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeStep, setActiveStep] = useState(0);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const categories = [
    { value: "corruption", label: "腐败行为", color: "#ff6b6b" },
    { value: "fraud", label: "财务欺诈", color: "#4ecdc4" },
    { value: "safety", label: "安全隐患", color: "#45b7d1" },
    { value: "environment", label: "环境污染", color: "#96ceb4" },
    { value: "other", label: "其他", color: "#feca57" }
  ];

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM初始化失败:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败，请检查钱包连接" 
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
        console.error('加载数据失败:', error);
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
      const reportsList: WhistleblowerReport[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          reportsList.push({
            id: businessId,
            title: businessData.name,
            category: "corruption",
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
          console.error('加载举报数据错误:', e);
        }
      }
      
      setReports(reportsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createReport = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingReport(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE加密提交举报..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const evidenceValue = parseInt(newReportData.evidenceValue) || 0;
      const businessId = `report-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, evidenceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newReportData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newReportData.riskLevel) || 5,
        0,
        newReportData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `创建举报: ${newReportData.title}`]);
      setTransactionStatus({ visible: true, status: "success", message: "举报提交成功！" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadReports();
      setShowCreateModal(false);
      setNewReportData({ 
        title: "", 
        category: "corruption", 
        evidenceValue: "",
        riskLevel: "5",
        description: "" 
      });
      setActiveStep(0);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消了交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingReport(false); 
    }
  };

  const decryptReport = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadReports();
      setUserHistory(prev => [...prev, `解密举报证据: ${businessId}`]);
      
      setTransactionStatus({ visible: true, status: "success", message: "证据解密验证成功！" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadReports();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "系统状态检查成功: " + (isAvailable ? "正常运行" : "维护中")
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "系统状态检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getReportStats = (): ReportStats => {
    const totalReports = reports.length;
    const verifiedReports = reports.filter(r => r.isVerified).length;
    const pendingReports = totalReports - verifiedReports;
    const averageRisk = reports.length > 0 
      ? reports.reduce((sum, r) => sum + r.publicValue1, 0) / reports.length 
      : 0;
    
    return { totalReports, verifiedReports, pendingReports, averageRisk };
  };

  const filteredReports = reports.filter(report => 
    report.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    report.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsPanel = () => {
    const stats = getReportStats();
    
    return (
      <div className="stats-panels">
        <div className="stat-panel copper-panel">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>总举报数</h3>
            <div className="stat-value">{stats.totalReports}</div>
          </div>
        </div>
        
        <div className="stat-panel copper-panel">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>已核实</h3>
            <div className="stat-value">{stats.verifiedReports}</div>
          </div>
        </div>
        
        <div className="stat-panel copper-panel">
          <div className="stat-icon">⏳</div>
          <div className="stat-content">
            <h3>待处理</h3>
            <div className="stat-value">{stats.pendingReports}</div>
          </div>
        </div>
        
        <div className="stat-panel copper-panel">
          <div className="stat-icon">⚠️</div>
          <div className="stat-content">
            <h3>平均风险</h3>
            <div className="stat-value">{stats.averageRisk.toFixed(1)}/10</div>
          </div>
        </div>
      </div>
    );
  };

  const renderStepGuide = () => {
    const steps = [
      { number: 1, title: "连接身份", description: "使用钱包匿名连接系统" },
      { number: 2, title: "提交证据", description: "证据将通过FHE加密保护" },
      { number: 3, title: "多方验证", description: "需要多方密钥联合解密" },
      { number: 4, title: "安全处理", description: "证据在加密状态下处理" }
    ];

    return (
      <div className="step-guide">
        <h3>举报流程指南</h3>
        <div className="steps-container">
          {steps.map((step, index) => (
            <div key={step.number} className={`step-item ${index === activeStep ? 'active' : ''}`}>
              <div className="step-number">{step.number}</div>
              <div className="step-content">
                <h4>{step.title}</h4>
                <p>{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    if (userHistory.length === 0) return null;
    
    return (
      <div className="history-panel">
        <h3>操作记录</h3>
        <div className="history-list">
          {userHistory.slice(-5).map((record, index) => (
            <div key={index} className="history-item">
              <span className="history-time">{new Date().toLocaleTimeString()}</span>
              <span className="history-action">{record}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🔒</div>
            <h1>隱私吹哨系統</h1>
          </div>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🛡️</div>
            <h2>保护举报人，守护正义</h2>
            <p>连接您的钱包，使用全同态加密技术安全提交举报证据</p>
            <div className="security-features">
              <div className="feature">
                <span>🔐</span>
                <p>端到端加密</p>
              </div>
              <div className="feature">
                <span>👤</span>
                <p>完全匿名</p>
              </div>
              <div className="feature">
                <span>🤝</span>
                <p>多方验证</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="metal-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">正在加载安全加密环境</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>加载举报系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">🔒</div>
          <div>
            <h1>隱私吹哨系統</h1>
            <p>Confidential Whistleblower System</p>
          </div>
        </div>
        
        <div className="header-actions">
          <div className="action-group">
            <button onClick={checkAvailability} className="system-check-btn">
              系统状态
            </button>
            <button onClick={() => setShowCreateModal(true)} className="create-report-btn">
              📝 提交举报
            </button>
          </div>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="content-grid">
          <section className="stats-section">
            <h2>举报数据统计</h2>
            {renderStatsPanel()}
            {renderStepGuide()}
          </section>

          <section className="reports-section">
            <div className="section-header">
              <h2>举报记录</h2>
              <div className="controls">
                <div className="search-box">
                  <input
                    type="text"
                    placeholder="搜索举报..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                </div>
                <button onClick={loadReports} className="refresh-btn" disabled={isRefreshing}>
                  {isRefreshing ? "刷新中..." : "🔄"}
                </button>
              </div>
            </div>

            <div className="reports-list">
              {filteredReports.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📄</div>
                  <p>暂无举报记录</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-first-btn">
                    提交第一个举报
                  </button>
                </div>
              ) : (
                filteredReports.map((report, index) => (
                  <div key={index} className="report-card metal-card">
                    <div className="report-header">
                      <div className="report-title">{report.title}</div>
                      <div className={`status-badge ${report.isVerified ? 'verified' : 'pending'}`}>
                        {report.isVerified ? '✅ 已核实' : '⏳ 待处理'}
                      </div>
                    </div>
                    
                    <div className="report-meta">
                      <span className="risk-level">风险等级: {report.publicValue1}/10</span>
                      <span className="report-date">
                        {new Date(report.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                    
                    <div className="report-description">{report.description}</div>
                    
                    <div className="report-actions">
                      <button 
                        onClick={() => decryptReport(report.id)}
                        disabled={isDecrypting}
                        className={`decrypt-btn ${report.isVerified ? 'verified' : ''}`}
                      >
                        {isDecrypting ? '解密中...' : report.isVerified ? '✅ 已解密' : '🔓 验证证据'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <aside className="sidebar">
            {renderUserHistory()}
            <div className="info-panel">
              <h3>FHE技术说明</h3>
              <div className="tech-info">
                <div className="tech-item">
                  <strong>全同态加密</strong>
                  <p>证据在加密状态下处理，保护举报人隐私</p>
                </div>
                <div className="tech-item">
                  <strong>多方解密</strong>
                  <p>需要多个密钥持有者联合才能解密证据</p>
                </div>
                <div className="tech-item">
                  <strong>抗审查</strong>
                  <p>加密数据不可被单方审查或篡改</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {showCreateModal && (
        <CreateReportModal
          onSubmit={createReport}
          onClose={() => {
            setShowCreateModal(false);
            setActiveStep(0);
          }}
          creating={creatingReport}
          reportData={newReportData}
          setReportData={setNewReportData}
          isEncrypting={isEncrypting}
          categories={categories}
          activeStep={activeStep}
          setActiveStep={setActiveStep}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="metal-spinner small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
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
  categories: any[];
  activeStep: number;
  setActiveStep: (step: number) => void;
}> = ({ onSubmit, onClose, creating, reportData, setReportData, isEncrypting, categories, activeStep, setActiveStep }) => {
  const steps = [
    { title: "基本信息", fields: ["title", "category"] },
    { title: "证据详情", fields: ["evidenceValue", "riskLevel", "description"] },
    { title: "确认提交", fields: [] }
  ];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'evidenceValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setReportData({ ...reportData, [name]: intValue });
    } else {
      setReportData({ ...reportData, [name]: value });
    }
  };

  const nextStep = () => {
    if (activeStep < steps.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const prevStep = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  const canProceed = () => {
    switch (activeStep) {
      case 0:
        return reportData.title.trim() !== "" && reportData.category !== "";
      case 1:
        return reportData.evidenceValue !== "" && reportData.description.trim() !== "";
      default:
        return true;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-report-modal metal-modal">
        <div className="modal-header">
          <h2>提交加密举报</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-progress">
          {steps.map((step, index) => (
            <div key={index} className={`progress-step ${index <= activeStep ? 'active' : ''}`}>
              <div className="step-dot">{index + 1}</div>
              <span>{step.title}</span>
            </div>
          ))}
        </div>
        
        <div className="modal-body">
          {activeStep === 0 && (
            <div className="form-step">
              <div className="form-group">
                <label>举报标题 *</label>
                <input
                  type="text"
                  name="title"
                  value={reportData.title}
                  onChange={handleChange}
                  placeholder="简要描述举报内容..."
                />
              </div>
              
              <div className="form-group">
                <label>举报类别 *</label>
                <select name="category" value={reportData.category} onChange={handleChange}>
                  {categories.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          
          {activeStep === 1 && (
            <div className="form-step">
              <div className="form-group">
                <label>证据数值 (整数) *</label>
                <input
                  type="number"
                  name="evidenceValue"
                  value={reportData.evidenceValue}
                  onChange={handleChange}
                  placeholder="请输入证据数值..."
                  min="0"
                  step="1"
                />
                <div className="input-note">FHE加密整数数据</div>
              </div>
              
              <div className="form-group">
                <label>风险等级 (1-10)</label>
                <input
                  type="range"
                  name="riskLevel"
                  min="1"
                  max="10"
                  value={reportData.riskLevel}
                  onChange={handleChange}
                />
                <div className="risk-value">{reportData.riskLevel}/10</div>
              </div>
              
              <div className="form-group">
                <label>详细描述 *</label>
                <textarea
                  name="description"
                  value={reportData.description}
                  onChange={handleChange}
                  placeholder="请详细描述举报内容..."
                  rows={4}
                />
              </div>
            </div>
          )}
          
          {activeStep === 2 && (
            <div className="confirmation-step">
              <div className="confirmation-info">
                <h3>举报信息确认</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span>标题:</span>
                    <strong>{reportData.title}</strong>
                  </div>
                  <div className="info-item">
                    <span>类别:</span>
                    <strong>{categories.find(c => c.value === reportData.category)?.label}</strong>
                  </div>
                  <div className="info-item">
                    <span>证据数值:</span>
                    <strong>{reportData.evidenceValue} (FHE加密)</strong>
                  </div>
                  <div className="info-item">
                    <span>风险等级:</span>
                    <strong>{reportData.riskLevel}/10</strong>
                  </div>
                </div>
              </div>
              
              <div className="encryption-notice">
                <div className="notice-icon">🔐</div>
                <div>
                  <strong>全同态加密保护</strong>
                  <p>您的证据将通过Zama FHE技术加密，确保举报过程完全匿名和安全</p>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={activeStep === 0 ? onClose : prevStep} className="cancel-btn">
            {activeStep === 0 ? '取消' : '上一步'}
          </button>
          
          {activeStep < steps.length - 1 ? (
            <button onClick={nextStep} disabled={!canProceed()} className="next-btn">
              下一步 →
            </button>
          ) : (
            <button 
              onClick={onSubmit} 
              disabled={creating || isEncrypting || !canProceed()} 
              className="submit-btn"
            >
              {creating || isEncrypting ? "加密并提交中..." : "提交举报"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;