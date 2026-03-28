/**
 * Report Generator - PDF Diagnostic Reports
 * 
 * This module generates professional PDF diagnostic reports for iOS devices
 * using PDFKit. Reports include device information, status indicators,
 * and diagnostic data in a clean, printable format.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Color palette for the report
 */
const COLORS = {
    primary: '#1a1a2e',
    secondary: '#16213e',
    accent: '#0f3460',
    success: '#00b894',
    warning: '#fdcb6e',
    danger: '#e74c3c',
    text: '#2d3436',
    textLight: '#636e72',
    white: '#ffffff',
    border: '#dfe6e9'
};

/**
 * Generate a PDF diagnostic report for a device
 * @param {object} deviceData - Device information object
 * @returns {Promise<string>} Path to the generated PDF file
 */
async function generateReport(deviceData) {
    return new Promise((resolve, reject) => {
        try {
            // Create output directory if it doesn't exist
            const outputDir = getOutputDirectory();
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const deviceName = (deviceData.DeviceName || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
            const filename = `Device_Report_${deviceName}_${timestamp}.pdf`;
            const outputPath = path.join(outputDir, filename);

            // Create PDF document
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 50, bottom: 50, left: 50, right: 50 },
                info: {
                    Title: `iOS Device Report - ${deviceData.DeviceName || 'Unknown'}`,
                    Author: 'iOS Device Manager',
                    Subject: 'Device Diagnostic Report',
                    Keywords: 'iOS, device, diagnostic, report',
                    CreationDate: new Date()
                }
            });

            // Pipe to file
            const writeStream = fs.createWriteStream(outputPath);
            doc.pipe(writeStream);

            // Generate report content
            addHeader(doc, deviceData);
            addDeviceOverview(doc, deviceData);
            addDetailedInfo(doc, deviceData);
            addStatusSection(doc, deviceData);
            addFooter(doc);

            // Finalize the PDF
            doc.end();

            // Resolve when write is complete
            writeStream.on('finish', () => {
                console.log(`[ReportGenerator] Report saved to: ${outputPath}`);
                resolve(outputPath);
            });

            writeStream.on('error', (error) => {
                console.error('[ReportGenerator] Write stream error:', error);
                reject(error);
            });

        } catch (error) {
            console.error('[ReportGenerator] Error generating report:', error);
            reject(error);
        }
    });
}

/**
 * Get the output directory for reports
 * @returns {string} Path to reports directory
 */
function getOutputDirectory() {
    // Use user's Documents folder for reports
    const userDataPath = app.getPath('documents');
    return path.join(userDataPath, 'iOS Device Manager', 'Reports');
}

/**
 * Add header section to the report
 */
function addHeader(doc, deviceData) {
    // Header background
    doc.rect(0, 0, doc.page.width, 120)
        .fill(COLORS.primary);

    // Title
    doc.fillColor(COLORS.white)
        .fontSize(28)
        .font('Helvetica-Bold')
        .text('iOS Device Diagnostic Report', 50, 35);

    // Subtitle with device name
    doc.fontSize(14)
        .font('Helvetica')
        .text(deviceData.DeviceName || 'Unknown Device', 50, 70);

    // Report date
    const reportDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    doc.fontSize(10)
        .fillColor(COLORS.textLight)
        .text(`Generated: ${reportDate}`, 50, 90);

    // Status badge
    const isActivated = deviceData.ActivationState === 'Activated';
    const statusColor = deviceData.error ? COLORS.danger : (isActivated ? COLORS.success : COLORS.warning);
    const statusText = deviceData.error ? 'ERROR' : (isActivated ? 'ACTIVATED' : deviceData.ActivationState || 'UNKNOWN');

    const badgeWidth = 100;
    const badgeX = doc.page.width - 50 - badgeWidth;

    doc.roundedRect(badgeX, 45, badgeWidth, 30, 5)
        .fill(statusColor);

    doc.fillColor(COLORS.white)
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(statusText, badgeX, 53, { width: badgeWidth, align: 'center' });

    // Move cursor below header
    doc.y = 140;
}

/**
 * Add device overview section with key metrics
 */
function addDeviceOverview(doc, deviceData) {
    doc.fillColor(COLORS.text);

    // Section title
    addSectionTitle(doc, 'Device Overview');

    // Create a grid of key information
    const gridY = doc.y;
    const colWidth = (doc.page.width - 100) / 2;

    // Left column
    addInfoCard(doc, 50, gridY, colWidth - 10, 'Model', deviceData.ModelName || deviceData.Model || 'Unknown');
    addInfoCard(doc, 50, gridY + 60, colWidth - 10, 'iOS Version', deviceData.iOSVersion || 'Unknown');
    addInfoCard(doc, 50, gridY + 120, colWidth - 10, 'Serial Number', deviceData.SerialNumber || 'Unknown');

    // Right column  
    addInfoCard(doc, 50 + colWidth, gridY, colWidth - 10, 'Battery Level', deviceData.BatteryLevel || 'Unknown');
    addInfoCard(doc, 50 + colWidth, gridY + 60, colWidth - 10, 'Storage', formatStorage(deviceData));
    addInfoCard(doc, 50 + colWidth, gridY + 120, colWidth - 10, 'IMEI', deviceData.IMEI || 'N/A');

    doc.y = gridY + 200;
}

/**
 * Add detailed information section
 */
function addDetailedInfo(doc, deviceData) {
    addSectionTitle(doc, 'Detailed Information');

    const details = [
        { label: 'Device Name', value: deviceData.DeviceName || 'Unknown' },
        { label: 'Model Identifier', value: deviceData.Model || 'Unknown' },
        { label: 'Hardware Model', value: deviceData.HardwareModel || 'Unknown' },
        { label: 'Color', value: deviceData.Color || 'Unknown' },
        { label: 'Build Version', value: deviceData.BuildVersion || 'Unknown' },
        { label: 'UDID', value: deviceData.uuid || deviceData.UDID || 'Unknown' },
        { label: 'MEID', value: deviceData.MEID || 'N/A' },
        { label: 'WiFi MAC', value: deviceData.WiFiAddress || 'Unknown' },
        { label: 'Bluetooth MAC', value: deviceData.BluetoothAddress || 'Unknown' },
        { label: 'Phone Number', value: deviceData.PhoneNumber || 'N/A' },
        { label: 'Carrier', value: deviceData.CarrierName || 'N/A' },
        { label: 'Region', value: deviceData.RegionInfo || 'Unknown' },
        { label: 'Time Zone', value: deviceData.TimeZone || 'Unknown' }
    ];

    // Create table
    const tableTop = doc.y;
    const rowHeight = 25;
    const col1Width = 150;
    const col2Width = doc.page.width - 100 - col1Width;

    details.forEach((item, index) => {
        const y = tableTop + (index * rowHeight);

        // Check for page break
        if (y > doc.page.height - 100) {
            doc.addPage();
            doc.y = 50;
            return;
        }

        // Alternate row background
        if (index % 2 === 0) {
            doc.rect(50, y, doc.page.width - 100, rowHeight)
                .fill('#f8f9fa');
        }

        // Label
        doc.fillColor(COLORS.textLight)
            .fontSize(10)
            .font('Helvetica')
            .text(item.label, 60, y + 7, { width: col1Width - 20 });

        // Value
        doc.fillColor(COLORS.text)
            .font('Helvetica-Bold')
            .text(item.value, 50 + col1Width, y + 7, { width: col2Width - 20 });
    });

    doc.y = tableTop + (details.length * rowHeight) + 20;
}

/**
 * Add status section with diagnostic indicators
 */
function addStatusSection(doc, deviceData) {
    // Check if we need a new page
    if (doc.y > doc.page.height - 200) {
        doc.addPage();
        doc.y = 50;
    }

    addSectionTitle(doc, 'Diagnostic Status');

    const statuses = [
        {
            label: 'Activation Status',
            value: deviceData.ActivationState || 'Unknown',
            status: deviceData.ActivationState === 'Activated' ? 'success' :
                deviceData.ActivationState === 'Locked' ? 'danger' : 'warning'
        },
        {
            label: 'Battery Health',
            value: deviceData.BatteryHealth || 'Unknown',
            status: deviceData.BatteryHealth === 'Good' || deviceData.BatteryHealth === '100%' ? 'success' : 'warning'
        },
        {
            label: 'Device Trust',
            value: deviceData.error ? 'Not Trusted' : 'Trusted',
            status: deviceData.error ? 'danger' : 'success'
        }
    ];

    const startY = doc.y;
    const cardWidth = (doc.page.width - 120) / 3;

    statuses.forEach((item, index) => {
        const x = 50 + (index * (cardWidth + 10));
        const statusColor = item.status === 'success' ? COLORS.success :
            item.status === 'danger' ? COLORS.danger : COLORS.warning;

        // Card background
        doc.roundedRect(x, startY, cardWidth, 60, 5)
            .fill('#f8f9fa');

        // Status indicator
        doc.circle(x + 20, startY + 30, 8)
            .fill(statusColor);

        // Label
        doc.fillColor(COLORS.textLight)
            .fontSize(9)
            .font('Helvetica')
            .text(item.label, x + 35, startY + 15, { width: cardWidth - 45 });

        // Value
        doc.fillColor(COLORS.text)
            .fontSize(12)
            .font('Helvetica-Bold')
            .text(item.value, x + 35, startY + 32, { width: cardWidth - 45 });
    });

    doc.y = startY + 80;

    // Error message if present
    if (deviceData.error && deviceData.errorMessage) {
        doc.roundedRect(50, doc.y, doc.page.width - 100, 40, 5)
            .fill('#ffeaea');

        doc.fillColor(COLORS.danger)
            .fontSize(10)
            .font('Helvetica-Bold')
            .text('⚠ Error: ' + deviceData.errorMessage, 60, doc.y + 15, {
                width: doc.page.width - 120
            });

        doc.y += 50;
    }
}

/**
 * Add footer to the report
 */
function addFooter(doc) {
    const pageHeight = doc.page.height;

    // Footer line
    doc.strokeColor(COLORS.border)
        .lineWidth(1)
        .moveTo(50, pageHeight - 50)
        .lineTo(doc.page.width - 50, pageHeight - 50)
        .stroke();

    // Footer text
    doc.fillColor(COLORS.textLight)
        .fontSize(8)
        .font('Helvetica')
        .text(
            'Generated by iOS Device Manager | This report is for diagnostic purposes only',
            50,
            pageHeight - 40,
            { width: doc.page.width - 100, align: 'center' }
        );

    // Page number
    doc.text(
        `Page 1 of 1`,
        50,
        pageHeight - 30,
        { width: doc.page.width - 100, align: 'center' }
    );
}

/**
 * Add a section title
 */
function addSectionTitle(doc, title) {
    doc.fillColor(COLORS.primary)
        .fontSize(16)
        .font('Helvetica-Bold')
        .text(title, 50);

    // Underline
    doc.strokeColor(COLORS.accent)
        .lineWidth(2)
        .moveTo(50, doc.y + 5)
        .lineTo(200, doc.y + 5)
        .stroke();

    doc.y += 20;
}

/**
 * Add an info card
 */
function addInfoCard(doc, x, y, width, label, value) {
    // Card background
    doc.roundedRect(x, y, width, 50, 5)
        .fill('#f8f9fa');

    // Label
    doc.fillColor(COLORS.textLight)
        .fontSize(9)
        .font('Helvetica')
        .text(label, x + 10, y + 10, { width: width - 20 });

    // Value
    doc.fillColor(COLORS.text)
        .fontSize(14)
        .font('Helvetica-Bold')
        .text(value, x + 10, y + 28, { width: width - 20 });
}

/**
 * Format storage information
 */
function formatStorage(deviceData) {
    if (deviceData.TotalDiskCapacity && deviceData.TotalDiskCapacity !== 'Unknown') {
        if (deviceData.AvailableDiskSpace && deviceData.AvailableDiskSpace !== 'Unknown') {
            return `${deviceData.AvailableDiskSpace} / ${deviceData.TotalDiskCapacity}`;
        }
        return deviceData.TotalDiskCapacity;
    }
    return 'Unknown';
}

module.exports = {
    generateReport,
    getOutputDirectory
};
