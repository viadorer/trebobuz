// Rate limiting - maximálně 3 požadavky za hodinu
class RateLimiter {
    constructor(maxRequests, timeWindow) {
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
        this.requests = [];
    }

    tryRequest() {
        const now = Date.now();
        // Odstranění starých požadavků
        this.requests = this.requests.filter(time => now - time < this.timeWindow);

        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = this.requests[0];
            const timeToWait = Math.ceil((this.timeWindow - (now - oldestRequest)) / 1000 / 60);
            throw new Error(`Příliš mnoho požadavků. Zkuste to prosím znovu za ${timeToWait} minut.`);
        }

        this.requests.push(now);
        localStorage.setItem('rateLimitRequests', JSON.stringify(this.requests));
        return true;
    }

    loadFromStorage() {
        const stored = localStorage.getItem('rateLimitRequests');
        if (stored) {
            this.requests = JSON.parse(stored);
        }
    }
}

// Vytvoření instance rate limiteru (3 požadavky za hodinu)
const rateLimiter = new RateLimiter(3, 60 * 60 * 1000);

// Funkce pro dešifrování API klíče
function decrypt(encryptedKey) {
    // Jednoduchá XOR dešifrace s pevným klíčem
    const key = 'ptf';
    let decrypted = '';
    for(let i = 0; i < encryptedKey.length; i += 2) {
        const hex = encryptedKey.substr(i, 2);
        const char = parseInt(hex, 16);
        decrypted += String.fromCharCode(char ^ key.charCodeAt(i/2 % key.length));
    }
    return decrypted;
}

// Funkce pro odeslání formuláře do Ecomail
async function submitToEcomail(formData) {
    // Šifrovaný API klíč - vygenerovaný pomocí XOR šifry
    const ENCRYPTED_API_KEY = '5ed49ed8b3d8b5ed49ed8b3d8d';
    const ECOMAIL_API_KEY = decrypt(ENCRYPTED_API_KEY);
    const LIST_ID = '39';

    try {
        const requestData = {
            subscriber_data: {
                email: formData.email,
                name: formData.name,
                phone: formData.phone,
                custom_fields: {
                    message: formData.message
                }
            },
            trigger_autoresponders: true,
            update_existing: true,
            resubscribe: true,
            skip_confirmation: true
        };

        console.log('Odesílám data:', requestData);

        const response = await fetch('http://localhost:3000/api/ecomail/' + LIST_ID + '/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'key': ECOMAIL_API_KEY,
                'Origin': window.location.origin || 'http://localhost'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            if (response.status === 500) {
                throw new Error('Chyba na straně Ecomail serveru. Zkuste to prosím později.');
            }
            
            let errorMessage;
            try {
                const errorData = await response.json();
                errorMessage = errorData.message;
            } catch (e) {
                errorMessage = 'Chyba při komunikaci s Ecomail API';
            }
            throw new Error(errorMessage);
        }

        let data;
        try {
            const text = await response.text();
            // Očistíme text od případných znaků na konci
            const cleanJson = text.replace(/[^}]*$/, '');
            data = JSON.parse(cleanJson);
        } catch (e) {
            console.warn('Chyba při parsování odpovědi:', e);
            // Pokud se nepodaří naparsovat JSON, ale response je OK, považujeme to za úspěch
            return { success: true };
        }
        console.log('Ecomail response:', data);
        return data;
    } catch (error) {
        console.error('Ecomail API error:', error);
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Nepodařilo se spojit s Ecomail API. Zkontrolujte prosím připojení k internetu.');
        } else {
            throw new Error(error.message || 'Nastala neočekávaná chyba při odesílání formuláře.');
        }
    }
}

// Event listener pro formulář
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('contactForm');
    const submitButton = document.getElementById('submitButton');
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    // Načtení předchozích požadavků z localStorage
    rateLimiter.loadFromStorage();

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        
        // Disable submit button and show loading state
        submitButton.disabled = true;
        submitButton.innerHTML = '<svg class="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Odesílám...';

        try {
            // Kontrola rate limitingu
            rateLimiter.tryRequest();
            const formData = {
                name: form.name.value,
                email: form.email.value,
                phone: form.phone.value,
                message: form.message.value
            };

            await submitToEcomail(formData);
            
            // Show success message
            successMessage.classList.remove('hidden');
            errorMessage.classList.add('hidden');
            form.reset();

        } catch (error) {
            // Show error message
            errorMessage.textContent = error.message;
            errorMessage.classList.remove('hidden');
            successMessage.classList.add('hidden');

        } finally {
            // Reset button state
            submitButton.disabled = false;
            submitButton.innerHTML = 'Odeslat zprávu';
        }
    });
});
