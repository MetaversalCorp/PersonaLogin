import Session from "base";

class UserSession extends Session {
    constructor(user) {
        super();
        this.user = user;
        this.personas = [];
    }

    connect() {
        // Logic to connect the user session
        console.log(`User ${this.user.name} connected.`);
    }

    createPersona(personaData) {
        const newPersona = { ...personaData };
        this.personas.push(newPersona);
        console.log(`Persona created: ${newPersona.name}`);
    }

    pickPersona(personaName) {
        const persona = this.personas.find(p => p.name === personaName);
        if (persona) {
            console.log(`Persona picked: ${personaName}`);
            return persona;
        } else {
            console.error(`Persona ${personaName} not found.`);
            return null;
        }
    }

    disconnect() {
        console.log(`User ${this.user.name} disconnected.`);
    }
}