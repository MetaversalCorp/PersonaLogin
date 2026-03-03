// Updated UserSession.ts to allow empty lastName and fix geoPosSimpleToDouble3 conversion

function geoPosSimpleToDouble3(geoPos) {
    // ... implementation ...
}

export class UserSession {
    constructor(lastName) {
        this.lastName = lastName;
        this.wsSurname = lastName ? lastName : ''; // Set wsSurname to empty string if lastName is empty
    }
    // other methods
}