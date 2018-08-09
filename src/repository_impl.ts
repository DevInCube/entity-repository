import { Entity, IDao, SingleSelector, ManySelector, ChangeTracker, Repository, IRepository, IReadOnlyDao, ReadOnlyRepository, IChangeTracker, Tracker, IReadOnlyRepository } from "./repository";

// entities

export class UserEntity extends Entity {
    username: string;
    fullname: string;
    email?: string;
    group_id: string | null;
    student_id: number;
    role: string;  // @todo enum Roles from types
    is_excluded: boolean;
    telegram_id?: string;
    telegram_username?: string;

    get Id() { return this.id.toString(); }

    constructor(
        public readonly id: number, 
        public readonly bitbucketId: string
    ) {
        super();
    }
}

interface IUserDao extends IDao<UserEntity> {
    getByNameSelector(name: string): SingleSelector<UserEntity>;
    getStudentsByGroupId(groupId: string): ManySelector<UserEntity>;
}

//

export class GroupEntity extends Entity {
    id: string;
    name: string;
    year: number;
    color: string;

    get Id() { return this.id; }

    constructor() {
        super();
    }
}

export interface IGroupDao extends IReadOnlyDao<GroupEntity> {

}

// storage

export interface IPostgresConnection {
    query<TResult>(request: string, data?: any[]): Promise<TResult>;
	oneOrNone<TResult>(request: string, data?: any[]): Promise<TResult | undefined>;
	mutation(request: string, data?: any[]): Promise<void>;
}

export class PostgresUserDao implements IUserDao, IDao<UserEntity> {
    constructor(
        private connection: IPostgresConnection
    ) {

    }

    creator(): (entity: UserEntity) => Promise<void> {
        return x => this.connection.mutation("creating...", [x]); // @todo
    }    
    singleSelector(id: string): SingleSelector<UserEntity> {
        return () => this.connection.oneOrNone<UserEntity>("select * from users where id = $1", [+id]);
    }
    manySelector(): ManySelector<UserEntity> {
        return () => this.connection.query<UserEntity[]>("select * from users");
    }
    updater(): (entity: UserEntity) => Promise<void> {
        return x => this.connection.mutation("updating...", [x]); // @todo
    }
    deleter(): (entity: UserEntity) => Promise<void> {
        return x => this.connection.mutation("delete from users where id = $1", [x.id]);
    }
    //
    getByNameSelector(name: string): SingleSelector<UserEntity> {
        return () => this.connection.oneOrNone<UserEntity>("select * from users where username = $1", [+name]);
    }
    getStudentsByGroupId(groupId: string): ManySelector<UserEntity> {
        return () => this.connection.query<UserEntity[]>("select * from users where group_id = $1", [groupId]);
    }
}

export class StaticGroupDao implements IGroupDao {

    constructor(private groups: GroupEntity[]) {

    }

    singleSelector(id: string): SingleSelector<GroupEntity> {
        return async () => this.groups.find(x => x.id === id);
    }    
    manySelector(): ManySelector<GroupEntity> {
        return async () => this.groups;
    }
}

export class PostgresUserRepository extends Repository<UserEntity> {
    constructor(
        dao: PostgresUserDao,
        tracker: ChangeTracker<UserEntity>,
    ) {
        super(dao, tracker);
    }
}

export interface IUnitOfWork {
    users: IRepository<UserEntity>;
    usersDao: IUserDao;

    groups: IReadOnlyRepository<GroupEntity>;
    
    commit(): Promise<void>;
    rollback(): void;
}

export class TrackerManager {
    private trackers: IChangeTracker[] = [];

    create<T extends Entity>(dao: IDao<T>): ChangeTracker<T> {
        const tracker = new ChangeTracker<T>(dao);
        this.trackers.push(tracker);
        return tracker;
    }

    createReadOnly<T extends Entity>(): Tracker<T> {
        return new Tracker<T>();
    }

    async saveChanges() {
        for (const ct of this.trackers) {
            await ct.saveChanges();
        }
    }

    cancelChanges() {
        for (const ct of this.trackers) {
            ct.cancelChanges();
        }
    }
}

export class PostgresUnitOfWork implements IUnitOfWork {
    constructor(
        connection: IPostgresConnection,
        groupsList: GroupEntity[],
        private trackerManager = new TrackerManager(),
        public usersDao = new PostgresUserDao(connection),
        public users = new PostgresUserRepository(usersDao, trackerManager.create<UserEntity>(usersDao)),
        groupDao = new StaticGroupDao(groupsList),
        public groups = new GroupRepository(groupDao, trackerManager.createReadOnly<GroupEntity>())
    ) {
        
    }

    async commit(): Promise<void> {
        await this.trackerManager.saveChanges();
    }

    rollback(): void {
        this.trackerManager.cancelChanges();
    }
}

export class GroupRepository extends ReadOnlyRepository<GroupEntity> {

}
