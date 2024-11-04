export class RuntimeException {
     _message: string;

    constructor(message: string) {
        this._message = message;
    }

    get name(): string {
        return 'RuntimeException';
    }

    get message(): string {
        return this._message;
    }

    toString(): string {
        return this.name + ': ' + this.message;
    }
}

export class IllegalStateException extends RuntimeException {
    constructor(message: string) {
        super(message);
    }

    get name(): string {
        return 'IllegalStateException';
    }
}

export class InvalidArgumentException extends RuntimeException {
    constructor(message: string) {
        super(message);
    }

    get name(): string {
        return 'InvalidArgumentException';
    }
}

export class NotImplementedException extends RuntimeException {
    constructor(message: string) {
        super(message);
    }

    get name(): string {
        return 'NotImplementedException';
    }
}