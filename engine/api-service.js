/**
 * API Service for external lookups (GSX, IMEI)
 */
class APIService {
    constructor() {
        // TODO: Register at imeicheck.com or sickw.com and put your API key here
        this.apiKey = process.env.API_KEY || 'WYNlECzoWb0WekaYyVAFwVaaW5ujH7ScGxyOiOo68adb56e3';

        // Example base URL for a service like IMEICheck
        this.baseUrl = 'https://api.imeicheck.net/v1';
    }

    /**
     * Fetch GSX information for a given IMEI. (Requires Paid Service ID usually)
     * @param {string} imei - The device IMEI 
     */
    async getGSXInfo(imei) {
        if (!imei) throw new Error('IMEI is required for GSX lookup');

        console.log(`[API Service] Fetching GSX info for IMEI: ${imei}`);

        try {
            // Example for IMEICheck API:
            // serviceId would be the specific GSX service you want to run (e.g., 12 for FMI/SimLock)
            const response = await fetch(`${this.baseUrl}/checks`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept-Language': 'en'
                },
                body: JSON.stringify({
                    deviceId: imei,
                    serviceId: 1 // Replace with actual GSX service ID from provider
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            // Map the provider's specific JSON response to our app's format
            return {
                simLock: data.object?.simLockStatus || 'Unknown',
                findMyIphone: data.object?.fmiOn === true ? 'ON' : 'OFF',
                warrantyStatus: data.object?.warrantyStatus || 'Unknown',
                coverageEndDate: data.object?.estimatedPurchaseDate || 'Unknown',
                purchaseCountry: data.object?.purchaseCountry || 'Unknown',
                modelDescription: data.object?.modelDesc || 'Unknown'
            };
        } catch (error) {
            console.error('[API Service] GSX Fetch failed:', error);
            // Fallback to mock data for testing if API fails or key is missing
            return {
                simLock: 'API Error / Unlocked (Mock)',
                findMyIphone: 'API Error / OFF (Mock)',
                warrantyStatus: 'Expired (Mock)',
                coverageEndDate: '2023-01-01',
                purchaseCountry: 'United States',
                modelDescription: 'iPhone 13 (Mock)'
            };
        }
    }

    /**
     * Fetch basic IMEI information (Usually Free on providers like IMEICheck)
     * @param {string} imei - The device IMEI 
     */
    async getIMEIInfo(imei) {
        if (!imei) throw new Error('IMEI is required for IMEI lookup');

        console.log(`[API Service] Fetching IMEI info for IMEI: ${imei}`);

        try {
            const response = await fetch(`${this.baseUrl}/checks`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept-Language': 'en'
                },
                body: JSON.stringify({
                    deviceId: imei,
                    serviceId: 1 // Example ID for a "Free Basic Check" service
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            return {
                status: data.object?.status || 'Unknown',
                blacklistStatus: data.object?.blacklistStatus || 'Clean',
                carrier: data.object?.network || 'Unknown'
            };
        } catch (error) {
            console.error('[API Service] IMEI Fetch failed:', error);
            // Fallback to mock data
            return {
                status: 'Clean (Mock)',
                blacklistStatus: 'Clean (Mock)',
                carrier: 'Verizon (Mock)'
            };
        }
    }
}

module.exports = new APIService();
