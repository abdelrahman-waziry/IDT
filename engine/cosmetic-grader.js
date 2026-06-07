/**
 * Cosmetic Grader — OpenRouter Integration
 *
 * Analyzes uploaded device photos for cosmetic defects using
 * OpenRouter's free vision-capable models.
 * Returns a structured grade report.
 *
 * @module engine/cosmetic-grader
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// OpenRouter API endpoint (OpenAI-compatible)
const OPENROUTER_API_HOST = 'openrouter.ai';
const OPENROUTER_API_PATH = '/api/v1/chat/completions';

// Free vision-capable models to try in order of preference
const FREE_MODELS = [
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
];

// Cosmetic grades
const GRADES = {
    A_PLUS: { grade: 'A+', label: 'Flawless', color: '#22c55e', description: 'No visible defects. Like-new condition.' },
    A: { grade: 'A', label: 'Excellent', color: '#22c55e', description: 'Minimal signs of use. No functional damage.' },
    B_PLUS: { grade: 'B+', label: 'Very Good', color: '#84cc16', description: 'Minor cosmetic wear. No cracks or chips.' },
    B: { grade: 'B', label: 'Good', color: '#eab308', description: 'Visible scratches or scuffs. Fully functional.' },
    C: { grade: 'C', label: 'Fair', color: '#f97316', description: 'Noticeable damage. May affect resale value.' },
    D: { grade: 'D', label: 'Poor', color: '#ef4444', description: 'Significant damage. Cracked screen or housing.' }
};

/**
 * Get the MIME type for an image file
 * @param {string} filePath
 * @returns {string}
 */
function getMediaType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    };
    return mimeMap[ext] || 'image/jpeg';
}

/**
 * The grading prompt text for the AI model
 * @returns {string}
 */
function getGradingPrompt() {
    return `You are an expert mobile device cosmetic grading specialist. You have been shown photos of a mobile device from multiple angles.

Analyze each photo carefully for cosmetic defects including but not limited to:
- Scratches (light, deep, hairline)
- Cracks (screen, back glass, camera lens)
- Dents and dings
- Chips and nicks
- Scuffs and abrasions
- Discoloration or staining
- Bends or warping
- Water damage indicators
- Burn marks
- Corrosion or rust
- Peeling coatings

For each photo, provide a score from 0-100 (100 = flawless) and list any defects found.

Respond ONLY with valid JSON in this exact format (no markdown fences, no extra text):
{
    "imageScores": [
        {
            "view": "<view_name>",
            "score": <0-100>,
            "defects": [
                {
                    "type": "<defect_type>",
                    "severity": "<minor|moderate|severe>",
                    "confidence": <0.0-1.0>,
                    "description": "<brief description>"
                }
            ],
            "notes": "<brief overall assessment for this angle>"
        }
    ]
}`;
}

/**
 * Build OpenRouter chat messages with images (OpenAI-compatible format)
 * @param {object} photos - Map of { [view]: filePath }
 * @returns {Array} Messages array for OpenRouter
 */
function buildChatMessages(photos) {
    const contentParts = [];

    // Add each photo as a base64 image_url block
    for (const [view, filePath] of Object.entries(photos)) {
        const imageBuffer = fs.readFileSync(filePath);
        const base64Image = imageBuffer.toString('base64');
        const mediaType = getMediaType(filePath);

        contentParts.push({
            type: 'image_url',
            image_url: {
                url: `data:${mediaType};base64,${base64Image}`
            }
        });

        // Label the photo with its view name
        contentParts.push({
            type: 'text',
            text: `[Photo: ${view.replace(/_/g, ' ')}]`
        });
    }

    // Add the grading prompt
    contentParts.push({
        type: 'text',
        text: getGradingPrompt()
    });

    return [
        {
            role: 'user',
            content: contentParts
        }
    ];
}

/**
 * Call OpenRouter API to analyze device photos
 * @param {object} photos - Map of { [view]: filePath }
 * @param {string} apiKey - OpenRouter API key
 * @param {string} model - Model identifier to use
 * @returns {Promise<object>} Parsed response with image scores
 */
function analyzeWithOpenRouter(photos, apiKey, model) {
    return new Promise((resolve, reject) => {
        const messages = buildChatMessages(photos);

        const requestBody = JSON.stringify({
            model: model,
            messages: messages,
            max_tokens: 4096,
            temperature: 0.2
        });

        const options = {
            hostname: OPENROUTER_API_HOST,
            path: OPENROUTER_API_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://mezatech.io',
                'X-Title': 'IDT Cosmetic Grader'
            }
        };

        console.log(`[CosmeticGrader] Sending ${Object.keys(photos).length} photos to OpenRouter (model: ${model})...`);

        const req = https.request(options, (res) => {
            console.log(`[CosmeticGrader] OpenRouter Response Status: ${res.statusCode}`);
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log(`[CosmeticGrader] OpenRouter Response received (Length: ${data.length})`);
                console.log('[CosmeticGrader] ===== FULL RAW API RESPONSE START =====');
                console.log(data);
                console.log('[CosmeticGrader] ===== FULL RAW API RESPONSE END =====');
                try {
                    const parsed = JSON.parse(data);

                    if (parsed.error) {
                        const errMsg = parsed.error.message || parsed.error.code || JSON.stringify(parsed.error);
                        reject(new Error(`OpenRouter API error: ${errMsg}`));
                        return;
                    }

                    // Log full response structure for debugging
                    console.log('[CosmeticGrader] Response keys:', Object.keys(parsed));
                    if (parsed.choices && parsed.choices.length > 0) {
                        const choice = parsed.choices[0];
                        console.log('[CosmeticGrader] Choice keys:', Object.keys(choice));
                        if (choice.message) {
                            console.log('[CosmeticGrader] Message keys:', Object.keys(choice.message));
                            console.log('[CosmeticGrader] Content type:', typeof choice.message.content);
                            console.log('[CosmeticGrader] Content preview:', String(choice.message.content).substring(0, 200));
                        }
                    }

                    // Extract text content — try multiple possible locations
                    let textBlock = null;

                    // Standard OpenAI format
                    if (parsed.choices?.[0]?.message?.content) {
                        textBlock = parsed.choices[0].message.content;
                    }
                    // Some models put it in a 'text' field
                    else if (parsed.choices?.[0]?.text) {
                        textBlock = parsed.choices[0].text;
                    }
                    // Some models return content as an array of parts
                    else if (Array.isArray(parsed.choices?.[0]?.message?.content)) {
                        const textPart = parsed.choices[0].message.content.find(p => p.type === 'text');
                        if (textPart) textBlock = textPart.text;
                    }
                    // Check if there's a refusal or finish_reason issue
                    else if (parsed.choices?.[0]?.message?.refusal) {
                        reject(new Error(`Model refused: ${parsed.choices[0].message.refusal}`));
                        return;
                    }

                    if (!textBlock) {
                        console.error('[CosmeticGrader] Full response dump:', JSON.stringify(parsed).substring(0, 1000));
                        reject(new Error('No text content in OpenRouter response'));
                        return;
                    }

                    // Parse the JSON from the model's text response
                    const responseText = textBlock.trim();
                    // Strip markdown code fences if present
                    const jsonText = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

                    const gradeData = JSON.parse(jsonText);
                    resolve(gradeData);

                } catch (e) {
                    console.error('[CosmeticGrader] Parse error:', e.message);
                    console.error('[CosmeticGrader] Raw response:', data.substring(0, 500));
                    reject(new Error('Failed to parse OpenRouter API response: ' + e.message));
                }
            });
        });

        req.on('error', (err) => {
            console.error('[CosmeticGrader] Request error:', err.message);
            reject(err);
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * Determine overall cosmetic grade from individual photo scores
 * @param {object[]} imageScores - Array of { view, score, defects }
 * @returns {object} Overall grade report
 */
function deduplicateImageScores(imageScores) {
    const seen = new Set();
    const unique = [];
    for (const score of imageScores) {
        const key = score.view;
        if (seen.has(key)) {
            console.warn(`[CosmeticGrader] Duplicate view "${key}" removed from surface breakdown`);
            continue;
        }
        seen.add(key);
        unique.push(score);
    }
    if (unique.length < imageScores.length) {
        console.log(`[CosmeticGrader] Deduplication: ${imageScores.length} → ${unique.length} entries`);
    }
    return unique;
}

function computeOverallGrade(imageScores) {
    if (!imageScores.length) {
        return { ...GRADES.C, overallScore: 0, imageScores, totalDefects: 0, defectSummary: [] };
    }

    // Deduplicate before computing
    const dedupedScores = deduplicateImageScores(imageScores);

    const avgScore = dedupedScores.reduce((sum, s) => sum + s.score, 0) / dedupedScores.length;

    // Attach parent view name to each defect for contextual diagnostic notes
    const allDefects = dedupedScores.flatMap(s =>
        (s.defects || []).map(d => ({
            ...d,
            view: s.view,
            viewLabel: s.view.replace(/_/g, ' ')
        }))
    );

    const hasCritical = allDefects.some(d =>
        ['crack', 'shatter', 'broken', 'fracture'].includes(d.type) && (d.confidence || 0) > 0.7
    );

    let grade;
    if (hasCritical) {
        grade = GRADES.D;
    } else if (avgScore >= 95) {
        grade = GRADES.A_PLUS;
    } else if (avgScore >= 85) {
        grade = GRADES.A;
    } else if (avgScore >= 75) {
        grade = GRADES.B_PLUS;
    } else if (avgScore >= 60) {
        grade = GRADES.B;
    } else if (avgScore >= 40) {
        grade = GRADES.C;
    } else {
        grade = GRADES.D;
    }

    return {
        ...grade,
        overallScore: Math.round(avgScore),
        imageScores: dedupedScores,
        totalDefects: allDefects.length,
        defectSummary: allDefects
    };
}

/**
 * Grade all cosmetic photos for a session.
 * Tries multiple free models on OpenRouter with automatic fallback.
 * @param {object} photos - Map of { [view]: filePath }
 * @param {string} apiKey - OpenRouter API key
 * @returns {Promise<object>} Full grade report
 */
async function gradePhotos(photos, apiKey) {
    if (!apiKey) {
        throw new Error('[CosmeticGrader] CRITICAL: No OpenRouter API key provided. AI assessment is required and simulation is disabled.');
    }

    const photoKeys = Object.keys(photos);
    console.log(`[CosmeticGrader] Grading ${photoKeys.length} photos via OpenRouter`);

    // Pre-flight: validate all photo files are readable
    for (const [view, filePath] of Object.entries(photos)) {
        try {
            const stat = fs.statSync(filePath);
            console.log(`[CosmeticGrader] Photo "${view}": ${filePath} (${(stat.size / 1024).toFixed(1)} KB, readable: true)`);
            if (stat.size === 0) {
                console.error(`[CosmeticGrader] WARNING: Photo "${view}" is 0 bytes — AI will likely fail on this angle`);
            }
        } catch (statErr) {
            console.error(`[CosmeticGrader] ERROR: Photo "${view}" unreadable at ${filePath}: ${statErr.message}`);
        }
    }

    let lastError = null;

    // Try each free model in order until one succeeds
    for (const model of FREE_MODELS) {
        const modelStartTime = Date.now();
        try {
            console.log(`[CosmeticGrader] Trying model: ${model}`);
            const result = await analyzeWithOpenRouter(photos, apiKey, model);
            const modelElapsed = ((Date.now() - modelStartTime) / 1000).toFixed(1);
            console.log(`[CosmeticGrader] Model responded in ${modelElapsed}s`);

            const imageScores = (result.imageScores || []).map(score => ({
                view: score.view,
                score: Math.max(0, Math.min(100, score.score)),
                defects: (score.defects || []).map(d => ({
                    type: d.type || 'unknown',
                    severity: d.severity || 'minor',
                    confidence: d.confidence || 0.5,
                    description: d.description || '',
                    source: 'openrouter'
                })),
                notes: score.notes || ''
            }));

            // Verbose: log what the model returned vs what we sent
            const returnedViews = imageScores.map(s => s.view);
            console.log(`[CosmeticGrader] Views sent: [${photoKeys.join(', ')}]`);
            console.log(`[CosmeticGrader] Views returned: [${returnedViews.join(', ')}]`);

            // If model returned fewer scores than photos, pad with diagnostic defaults
            const scoredViews = new Set(returnedViews);
            for (const view of photoKeys) {
                if (!scoredViews.has(view)) {
                    // Diagnose WHY this view was missed
                    const filePath = photos[view];
                    let diagMsg = `Model "${model}" did not return a score for view "${view}".`;
                    try {
                        const stat = fs.statSync(filePath);
                        diagMsg += ` File exists (${(stat.size / 1024).toFixed(1)} KB).`;
                        if (stat.size < 1024) {
                            diagMsg += ' File may be too small / corrupt for analysis.';
                        }
                    } catch {
                        diagMsg += ` File NOT found at ${filePath} — image was likely deleted before grading.`;
                    }
                    diagMsg += ` Model returned ${returnedViews.length}/${photoKeys.length} views in ${modelElapsed}s.`;
                    if (parseFloat(modelElapsed) > 30) {
                        diagMsg += ' Possible timeout — model took >30s.';
                    }

                    console.error(`[CosmeticGrader] ANALYSIS FAILURE: ${diagMsg}`);

                    imageScores.push({
                        view,
                        score: 50,
                        defects: [],
                        notes: `AI failed to analyze this angle. Diagnostic: ${diagMsg}`
                    });
                }
            }

            for (const s of imageScores) {
                console.log(`[CosmeticGrader] ${s.view}: score=${s.score}, defects=${s.defects.length}, notes=${s.notes.substring(0, 80)}`);
            }

            console.log(`[CosmeticGrader] Successfully graded with model: ${model}`);
            const finalReport = computeOverallGrade(imageScores);
            console.log('[CosmeticGrader] ===== FINAL GRADE REPORT START =====');
            console.log(JSON.stringify(finalReport, null, 2));
            console.log('[CosmeticGrader] ===== FINAL GRADE REPORT END =====');
            return finalReport;

        } catch (err) {
            console.warn(`[CosmeticGrader] Model ${model} failed: ${err.message}`);
            lastError = err;
            // Continue to next model
        }
    }

    // All models failed
    console.error(`[CosmeticGrader] All models failed. Last error:`, lastError?.message);
    throw new Error(`AI Grading Failed: ${lastError?.message || 'All models failed'}. Please check your internet connection or API credits.`);
}

module.exports = {
    gradePhotos,
    analyzeWithOpenRouter,
    GRADES
};
