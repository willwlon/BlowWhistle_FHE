pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BlowWhistle_FHE is ZamaEthereumConfig {
    struct WhistleblowerReport {
        euint32 encryptedEvidence;
        address submitter;
        uint256 timestamp;
        bool isDecrypted;
        uint32 decryptedEvidence;
    }

    mapping(string => WhistleblowerReport) public reports;
    string[] public reportIds;

    event ReportSubmitted(string indexed reportId, address indexed submitter);
    event ReportDecrypted(string indexed reportId, uint32 decryptedEvidence);

    constructor() ZamaEthereumConfig() {
    }

    function submitReport(
        string calldata reportId,
        externalEuint32 encryptedEvidence,
        bytes calldata inputProof
    ) external {
        require(bytes(reports[reportId].submitter).length == 0, "Report already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedEvidence, inputProof)), "Invalid encrypted evidence");

        reports[reportId] = WhistleblowerReport({
            encryptedEvidence: FHE.fromExternal(encryptedEvidence, inputProof),
            submitter: msg.sender,
            timestamp: block.timestamp,
            isDecrypted: false,
            decryptedEvidence: 0
        });

        FHE.allowThis(reports[reportId].encryptedEvidence);
        FHE.makePubliclyDecryptable(reports[reportId].encryptedEvidence);

        reportIds.push(reportId);
        emit ReportSubmitted(reportId, msg.sender);
    }

    function decryptReport(
        string calldata reportId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(reports[reportId].submitter).length > 0, "Report does not exist");
        require(!reports[reportId].isDecrypted, "Report already decrypted");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(reports[reportId].encryptedEvidence);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        reports[reportId].decryptedEvidence = decodedValue;
        reports[reportId].isDecrypted = true;
        emit ReportDecrypted(reportId, decodedValue);
    }

    function getEncryptedEvidence(string calldata reportId) external view returns (euint32) {
        require(bytes(reports[reportId].submitter).length > 0, "Report does not exist");
        return reports[reportId].encryptedEvidence;
    }

    function getReportDetails(string calldata reportId) external view returns (
        address submitter,
        uint256 timestamp,
        bool isDecrypted,
        uint32 decryptedEvidence
    ) {
        require(bytes(reports[reportId].submitter).length > 0, "Report does not exist");
        WhistleblowerReport storage report = reports[reportId];
        return (report.submitter, report.timestamp, report.isDecrypted, report.decryptedEvidence);
    }

    function getAllReportIds() external view returns (string[] memory) {
        return reportIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

